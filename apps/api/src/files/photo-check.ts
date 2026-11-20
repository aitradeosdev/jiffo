import { Worker } from 'node:worker_threads';
import sharp from 'sharp';

/** The photo types people may send (docs/security-plan.md, C1), told apart by their bytes, not their name. */
export type PhotoFormat = 'jpeg' | 'png' | 'heic';

/**
 * The most pixels a photo may have. Far more than any phone camera's normal setting (12 to 50), and well
 * under what would let a small file, a "pixel bomb", take the server's memory as it is opened.
 */
export const MAX_PIXELS = 100_000_000;
/** Photos are kept no larger than this on their longest side: plenty to read a receipt. */
export const MAX_SIDE = 2560;
const JPEG_QUALITY = 82;
/** A HEIC photo that takes longer than this to open is given up on. */
const HEIC_TIMEOUT_MS = 30_000;
/** Photos opened at once in one API process: each can take a few hundred megabytes while it is. */
const AT_ONCE = 2;

/** Why a photo couldn't be kept. Only ever told to the person as "couldn't be read". */
export class UnreadablePhoto extends Error {
  constructor(readonly reason: 'not_a_photo' | 'too_many_pixels' | 'broken') {
    super(`Unreadable photo: ${reason}`);
  }
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** What a file really is, from its first bytes: JPEG, PNG, HEIC, or none of them. */
export function formatOf(bytes: Buffer): PhotoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  // An ISO media file: a box whose type is ftyp, then its brand.
  if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp') {
    if (HEIC_BRANDS.has(bytes.toString('latin1', 8, 12))) return 'heic';
  }
  return null;
}

let running = 0;
const waiting: Array<() => void> = [];
/** Runs `work` once fewer than AT_ONCE photos are being opened in this process. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * Opens the photo and writes it again as a plain JPEG (C1): turned the way the camera held it, no larger
 * than MAX_SIDE, and with nothing but its pixels. Location, camera and any other details are gone, and so
 * is anything hidden in the file. A file that isn't a whole JPEG, PNG or HEIC photo is refused.
 */
export function rewritePhoto(bytes: Buffer): Promise<Buffer> {
  const format = formatOf(bytes);
  if (!format) return Promise.reject(new UnreadablePhoto('not_a_photo'));
  return inTurn(async () => {
    const input = format === 'heic' ? await openHeic(bytes) : await openImage(bytes, format);
    try {
      return await input
        .autoOrient()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch {
      throw new UnreadablePhoto('broken');
    }
  });
}

async function openImage(bytes: Buffer, format: 'jpeg' | 'png') {
  // The header alone, to count the pixels before anything is opened: no limit is needed to read it.
  const meta = await sharp(bytes, { limitInputPixels: false })
    .metadata()
    .catch(() => null);
  if (!meta || meta.format !== format || !meta.width || !meta.height) throw new UnreadablePhoto('broken');
  if (meta.width * meta.height > MAX_PIXELS) throw new UnreadablePhoto('too_many_pixels');
  // A cut-off or damaged file is refused (failOn), not kept half grey.
  return sharp(bytes, { limitInputPixels: MAX_PIXELS, sequentialRead: true, failOn: 'warning' });
}

/**
 * HEIC, as iPhones save photos: the image library on the server can't open it, so it is opened with
 * libheif on a worker thread (it would hold up every other request while it ran), and handed on as pixels.
 */
async function openHeic(bytes: Buffer) {
  const decoded = await new Promise<{ width: number; height: number; data: Uint8ClampedArray }>((resolve, reject) => {
    const worker = new Worker(HEIC_WORKER, {
      eval: true,
      workerData: { decoder: require.resolve('heic-decode'), bytes, maxPixels: MAX_PIXELS },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new UnreadablePhoto('broken'));
    }, HEIC_TIMEOUT_MS);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    worker.once('message', (m: { error?: 'too_many_pixels' | 'broken' } & Partial<Awaited<typeof decoded>>) =>
      done(() =>
        m.error || !m.data ? reject(new UnreadablePhoto(m.error ?? 'broken')) : resolve(m as Awaited<typeof decoded>),
      ),
    );
    worker.once('error', () => done(() => reject(new UnreadablePhoto('broken'))));
    worker.once('exit', () => done(() => reject(new UnreadablePhoto('broken'))));
  });
  return sharp(Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), {
    raw: { width: decoded.width, height: decoded.height, channels: 4 },
    limitInputPixels: MAX_PIXELS,
  });
}

/** The worker that opens one HEIC photo, counting its pixels before it decodes any. */
const HEIC_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const decode = require(workerData.decoder);
(async () => {
  const images = await decode.all({ buffer: workerData.bytes });
  try {
    const first = images[0];
    if (!first || !first.width || !first.height) return parentPort.postMessage({ error: 'broken' });
    if (first.width * first.height > workerData.maxPixels) return parentPort.postMessage({ error: 'too_many_pixels' });
    const { width, height, data } = await first.decode();
    parentPort.postMessage({ width, height, data }, [data.buffer]);
  } finally {
    images.dispose();
  }
})().catch(() => parentPort.postMessage({ error: 'broken' }));
`;
