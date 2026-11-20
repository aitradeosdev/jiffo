import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { formatOf, inTurn, MAX_SIDE, rewritePhoto, UnreadablePhoto } from '../src/files/photo-check';
import { heicPhoto, photoWithLocation, pixelBomb, pngPhoto } from './images';

/** The server's own copy of every photo (docs/security-plan.md, C1). */
describe('photo check', () => {
  const refused = async (bytes: Buffer) => {
    const error = await rewritePhoto(bytes).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreadablePhoto);
    return (error as UnreadablePhoto).reason;
  };

  it('tells JPEG, PNG and HEIC apart by their bytes, and nothing else passes', async () => {
    expect(formatOf(await photoWithLocation())).toBe('jpeg');
    expect(formatOf(await pngPhoto())).toBe('png');
    expect(formatOf(heicPhoto())).toBe('heic');
    expect(
      formatOf(
        await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
          .webp()
          .toBuffer(),
      ),
    ).toBeNull();
    expect(formatOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(formatOf(Buffer.alloc(0))).toBeNull();
    expect(await refused(Buffer.from('GIF89a'))).toBe('not_a_photo');
  });

  it('writes a JPEG with nothing but the pixels, turned the way the camera held it', async () => {
    // Taken with the phone on its side: stored 64 wide, to be shown 48 wide.
    const kept = await rewritePhoto(await photoWithLocation({ orientation: 6 }));
    const meta = await sharp(kept).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 48, height: 64 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(kept.toString('latin1')).not.toMatch(/PhoneCo|Someone|Exif/);
  });

  it('opens HEIC and PNG photos and keeps them as JPEG, with a white background for see-through pixels', async () => {
    const fromHeic = await sharp(await rewritePhoto(heicPhoto())).metadata();
    expect(fromHeic).toMatchObject({ format: 'jpeg', width: 32, height: 24 });
    const fromPng = await rewritePhoto(await pngPhoto());
    expect(await sharp(fromPng).metadata()).toMatchObject({ format: 'jpeg', hasAlpha: false });
  });

  it('makes big photos smaller', async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#7a7' } })
      .jpeg()
      .toBuffer();
    expect(await sharp(await rewritePhoto(big)).metadata()).toMatchObject({ width: MAX_SIDE, height: 1920 });
  });

  it('refuses a pixel bomb before opening it, and broken or disguised files', async () => {
    expect(await refused(pixelBomb())).toBe('too_many_pixels');
    const good = await photoWithLocation();
    expect(await refused(good.subarray(0, Math.floor(good.length / 2)))).toBe('broken');
    // JPEG's first bytes, then something else entirely.
    expect(await refused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<html>')]))).toBe('broken');
    // A HEIC box with nothing in it.
    expect(await refused(Buffer.concat([heicPhoto().subarray(0, 40)]))).toBe('broken');
  });

  it('never opens more than two photos at once, however the requests line up', async () => {
    let now = 0;
    let most = 0;
    const gates: Array<() => void> = [];
    const task = () =>
      inTurn(async () => {
        now += 1;
        most = Math.max(most, now);
        await new Promise<void>((open) => gates.push(open));
        now -= 1;
      });
    const all = [task(), task(), task()];
    await new Promise((r) => setImmediate(r));
    gates.shift()!();
    // New photos arriving at every point while the first finishes and the waiting one starts.
    for (let hops = 0; hops < 12; hops++) {
      let p = Promise.resolve();
      for (let i = 0; i < hops; i++) p = p.then(() => undefined);
      void p.then(() => all.push(task()));
    }
    while (gates.length || now) {
      await new Promise((r) => setImmediate(r));
      gates.shift()?.();
    }
    await Promise.all(all);
    expect(all).toHaveLength(15);
    expect(most).toBe(2);
  });
});
