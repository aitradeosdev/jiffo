import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryStorageAdapter } from '../src/adapters/storage';
import { CountriesService } from '../src/countries/countries.service';
import { disputeEvidence, uploads } from '../src/db/schema';
import { keptKey, UploadsService } from '../src/files/uploads.service';
import { ProvidersService } from '../src/providers/providers.service';
import { act, adminAs, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';
import { heicPhoto, photoWithLocation, pixelBomb, pngPhoto } from './images';

/**
 * Uploads (docs/security-plan.md, C1): only JPEG, PNG and HEIC photos, told apart by their real bytes, and
 * each one re-encoded on the server, which drops location and camera details and refuses broken files.
 * They are seen only through signed links that last the minutes Settings, Security give (5).
 */
describe('upload checks', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;
  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    agent = await signIn(t, 'agent');
    await fund(t, customer, 20_000_000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  const store = () => t.app.get(ProvidersService).current('storage') as MemoryStorageAdapter;
  /** An errand the agent is out on, buying the items. */
  const running = async () => {
    const errand = await createErrand(t, customer, { categoryKey: 'groceries' });
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    return errand.id;
  };
  /** Uploads these bytes, said to be this type, the way the apps do; gives the key. */
  const upload = async (errandId: string, bytes: Buffer, contentType: string, who = agent, purpose = 'receipt') => {
    const res = await request(t.http)
      .post('/v1/uploads')
      .set(who.headers)
      .send({ errandId, purpose, contentType, size: bytes.length })
      .expect(201);
    const url = new URL(res.body.upload.url);
    await request(t.http)
      .put(url.pathname + url.search)
      .set('content-type', contentType)
      .send(bytes)
      .expect(200);
    return res.body.key as string;
  };
  const useAsReceipt = (errandId: string, keys: string[], status = 200) =>
    act(t, agent, errandId, 'send_item_amount', { amountKobo: 500_000, photos: keys }, status);
  const kept = (key: string) => store().files.get(keptKey(key));

  it('keeps its own copy of a photo, with no location or camera details, and not the original', async () => {
    const errandId = await running();
    const original = await photoWithLocation();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const key = await upload(errandId, original, 'image/jpeg');
    await useAsReceipt(errandId, [key]);
    const copy = kept(key)!;
    const meta = await sharp(copy.bytes).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
    expect(meta.exif).toBeUndefined();
    expect(copy.bytes.toString('latin1')).not.toContain('PhoneCo');
    expect(copy.contentType).toBe('image/jpeg');
    expect(store().files.has(key)).toBe(false);
    // The customer is shown the copy.
    const seen = (await request(t.http).get(`/v1/errands/${errandId}`).set(customer.headers).expect(200)).body;
    const link = new URL(seen.photos.items[0]);
    const got = await request(t.http)
      .get(link.pathname + link.search)
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () => done(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(Buffer.compare(got.body as Buffer, copy.bytes)).toBe(0);
  });

  it("refuses a file whose bytes aren't a photo, whatever it says it is, a broken one, and a pixel bomb", async () => {
    const errandId = await running();
    const page = await upload(errandId, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg');
    expect((await useAsReceipt(errandId, [page], 422)).error.code).toBe('photo_unreadable');
    const good = await photoWithLocation();
    const broken = await upload(errandId, good.subarray(0, Math.floor(good.length / 2)), 'image/jpeg');
    expect((await useAsReceipt(errandId, [broken], 422)).error.code).toBe('photo_unreadable');
    const bomb = await upload(errandId, pixelBomb(), 'image/png');
    expect((await useAsReceipt(errandId, [bomb], 422)).error.code).toBe('photo_unreadable');
    // In chat too.
    const inChat = await upload(errandId, Buffer.from('not a photo'), 'image/png', customer, 'chat_photo');
    const sent = await request(t.http)
      .post(`/v1/errands/${errandId}/messages`)
      .set(customer.headers)
      .send({ photo: inChat, clientId: randomUUID() })
      .expect(422);
    expect(sent.body.error.code).toBe('photo_unreadable');
    // None of them is kept, or shown to staff.
    for (const key of [page, broken, bomb, inChat]) expect(kept(key)).toBeUndefined();
    const support = await adminAs(t, 'support');
    const detail = (await request(t.http).get(`/v1/admin/errands/${errandId}`).set(support.headers).expect(200)).body;
    expect(detail.photos).toEqual([]);
  });

  it("takes an iPhone's HEIC photo and a PNG, and keeps them as JPEG", async () => {
    const errandId = await running();
    const heic = await upload(errandId, heicPhoto(), 'image/heic');
    const png = await upload(errandId, await pngPhoto(), 'image/png');
    await useAsReceipt(errandId, [heic, png]);
    for (const key of [heic, png]) expect((await sharp(kept(key)!.bytes).metadata()).format).toBe('jpeg');
  });

  it('refuses types other than JPEG, PNG and HEIC', async () => {
    const errandId = await running();
    for (const contentType of ['image/webp', 'image/svg+xml', 'image/gif']) {
      const res = await request(t.http)
        .post('/v1/uploads')
        .set(agent.headers)
        .send({ errandId, purpose: 'receipt', contentType, size: 100 })
        .expect(422);
      expect(res.body.error.code).toBe('unsupported_file');
    }
  });

  it("keeps each photo's fingerprint for a dispute's evidence, and takes it again once checked", async () => {
    const errandId = await running();
    const key = await upload(errandId, await photoWithLocation(), 'image/jpeg');
    await useAsReceipt(errandId, [key]);
    const [row] = await t.db.select().from(uploads).where(eq(uploads.key, key));
    const copy = kept(key)!.bytes;
    expect(row).toMatchObject({
      contentType: 'image/jpeg',
      sha256: createHash('sha256').update(copy).digest('hex'),
      size: copy.length,
      checkedAt: expect.any(Date),
    });
    // Checked again (sent again after a dropped connection, say): the copy is used as it is, while it is there.
    const check = () =>
      t.app.get(UploadsService).assertUploaded([key], { ownerId: agent.userId, errandId, purposes: ['receipt'] });
    await check();
    expect(Buffer.compare(kept(key)!.bytes, copy)).toBe(0);
    await act(t, customer, errandId, 'open_dispute', { reason: 'The receipt looks wrong' });
    const [pack] = await t.db.select().from(disputeEvidence).where(eq(disputeEvidence.errandId, errandId));
    const listed = (pack!.content as { uploads: Array<{ key: string; sha256: string | null }> }).uploads;
    expect(listed.find((u) => u.key === key)?.sha256).toBe(row!.sha256);
    store().files.delete(keptKey(key));
    await expect(check()).rejects.toMatchObject({ response: { error: { code: 'photo_not_uploaded' } } });
  });

  it('shows photos through links that last the minutes Settings, Security give', async () => {
    const errandId = await running();
    const key = await upload(errandId, await photoWithLocation(), 'image/jpeg');
    await useAsReceipt(errandId, [key]);
    const lasts = async () => {
      const seen = (await request(t.http).get(`/v1/errands/${errandId}`).set(customer.headers).expect(200)).body;
      const exp = Number(new URL(seen.photos.items[0]).searchParams.get('exp'));
      return exp - Math.floor(Date.now() / 1000);
    };
    expect(Math.abs((await lasts()) - 5 * 60)).toBeLessThan(5);
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return (
        saved && {
          ...saved,
          settings: { ...saved.settings, security: { ...saved.settings.security, signedLinkMinutes: 2 } },
        }
      );
    });
    expect(Math.abs((await lasts()) - 2 * 60)).toBeLessThan(5);
  });
});
