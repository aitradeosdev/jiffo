import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

/** Photos for the upload tests, made as a phone or an attacker would. */

/** A small JPEG that says where and on what it was taken, as phone cameras' photos do. */
export const photoWithLocation = (options: { orientation?: number } = {}) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } })
    .withExif({
      IFD0: { Artist: 'Someone', Make: 'PhoneCo', Model: 'Phone 9' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 27/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '3/1 28/1 0/1' },
    })
    .withMetadata(options.orientation ? { orientation: options.orientation } : {})
    .jpeg()
    .toBuffer();

/** A real iPhone-style HEIC photo, 32 by 24. */
export const heicPhoto = () => readFileSync(join(__dirname, 'fixtures/photo.heic'));

/**
 * A "pixel bomb": a PNG of a few hundred bytes whose header says it is 30,000 pixels square, nearly a
 * billion pixels, which would take gigabytes to open.
 */
export function pixelBomb() {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const side = 30_000;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit grey
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(side + 1))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A small PNG with see-through pixels. */
export const pngPhoto = () =>
  sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } })
    .png()
    .toBuffer();
