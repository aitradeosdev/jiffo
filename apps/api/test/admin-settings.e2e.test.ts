import { and, eq, gt } from 'drizzle-orm';
import request from 'supertest';
import { categories, settingsVersions } from '../src/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAs, createTestApp, type TestApp } from './helpers';

type Admin = Awaited<ReturnType<typeof adminAs>>;

describe('admin settings', () => {
  let t: TestApp;
  let owner: Admin;
  let ops: Admin;
  let original: { version: number; settings: Record<string, unknown> };

  beforeAll(async () => {
    t = await createTestApp();
    [owner, ops] = await Promise.all([adminAs(t, 'owner'), adminAs(t, 'operations')]);
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  // The test database is shared by every test file in the run: remove what these tests made, so later files
  // see the launch settings and categories. (Saved versions can't be undone through the API, by design.)
  afterAll(async () => {
    await t.db
      .delete(settingsVersions)
      .where(and(eq(settingsVersions.countryCode, 'NG'), gt(settingsVersions.version, original.version)));
    await t.db.delete(categories).where(and(eq(categories.countryCode, 'NG'), eq(categories.key, 'books')));
    await t.close();
  });

  const config = async () => (await request(t.http).get('/v1/config/NG').expect(200)).body;
  const save = (body: Record<string, unknown>, who: Admin = owner) =>
    request(t.http).post('/v1/admin/settings?country=NG').set(who.headers).send(body);

  it('saves settings as a new version, with what changed and who changed it', async () => {
    const changed = structuredClone(original.settings) as { timers: Record<string, number> };
    changed.timers.depositAccountMinutes = 45;
    changed.timers.disputeDecisionHours = 72;

    expect((await save({ basedOn: original.version, settings: changed, note: 'Longer windows' }, ops)).status).toBe(
      403,
    );
    const res = await save({ basedOn: original.version, settings: changed, note: 'Longer windows for bank transfers' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: original.version + 1,
      changes: [
        { path: 'timers.depositAccountMinutes', from: 30, to: 45 },
        { path: 'timers.disputeDecisionHours', from: 48, to: 72 },
      ],
    });
    // The apps see the new version straight away.
    const c = await config();
    expect(c.settingsVersion).toBe(original.version + 1);
    expect(c.settings.timers.depositAccountMinutes).toBe(45);

    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(ops.headers).expect(200)).body;
    expect(now.history[0]).toMatchObject({ version: original.version + 1, createdBy: owner.name });
    expect(now.history[0].changes).toHaveLength(2);

    // Saving from an older version is refused, and saving nothing new makes no version.
    expect((await save({ basedOn: original.version, settings: changed, note: 'Again, from a stale tab' })).status).toBe(
      409,
    );
    expect((await save({ basedOn: now.version, settings: changed, note: 'Saved twice' })).body).toEqual({
      version: now.version,
      changes: [],
    });
    const audit = await request(t.http).get('/v1/admin/audit?targetType=settings').set(owner.headers).expect(200);
    expect(audit.body.entries[0]).toMatchObject({ action: 'settings.save', data: { version: now.version } });
  });

  it('refuses settings that break the rules', async () => {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const bad = structuredClone(now.settings) as { fees: Record<string, unknown> };
    bad.fees.serviceFeeMinKobo = 500_000;
    bad.fees.serviceFeeCapKobo = 100_000;
    const res = await save({ basedOn: now.version, settings: bad, note: 'Typo in the fees' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_settings');
    (bad.fees as Record<string, unknown>).serviceFeeCapKobo = -1;
    expect((await save({ basedOn: now.version, settings: bad, note: 'Typo in the fees' })).status).toBe(400);
  });

  it('adds, changes, hides and removes categories', async () => {
    const add = (body: Record<string, unknown>, who: Admin = owner) =>
      request(t.http)
        .post('/v1/admin/categories')
        .set(who.headers)
        .send({ country: 'NG', ...body });
    expect((await add({ key: 'books', name: 'Books', icon: 'bag' }, ops)).status).toBe(403);
    expect((await add({ key: 'Books!', name: 'Books', icon: 'bag' })).status).toBe(400);
    const created = await add({ key: 'books', name: 'Books and stationery', icon: 'bag', sort: 90 }).expect(201);
    expect((await add({ key: 'books', name: 'Books', icon: 'bag' })).status).toBe(409);
    expect((await config()).categories.map((c: { key: string }) => c.key)).toContain('books');

    const id = created.body.id;
    await request(t.http).patch(`/v1/admin/categories/${id}`).set(owner.headers).send({ active: false }).expect(200);
    expect((await config()).categories.map((c: { key: string }) => c.key)).not.toContain('books');
    // Hidden ones still show in the panel, to switch back on.
    const listed = await request(t.http).get('/v1/admin/categories?country=NG').set(ops.headers).expect(200);
    expect(listed.body.find((c: { id: string }) => c.id === id)).toMatchObject({ active: false });

    await request(t.http).delete(`/v1/admin/categories/${id}`).set(owner.headers).expect(200);
    const after = await request(t.http).get('/v1/admin/categories?country=NG').set(ops.headers).expect(200);
    expect(after.body.map((c: { id: string }) => c.id)).not.toContain(id);
    await request(t.http).delete(`/v1/admin/categories/${id}`).set(owner.headers).expect(404);
    // Its key is free again.
    await add({ key: 'books', name: 'Books', icon: 'bag' }).expect(201);
  });

  it('switches states on and off', async () => {
    const list = await request(t.http).get('/v1/admin/states?country=NG').set(ops.headers).expect(200);
    const kano = list.body.find((s: { code: string }) => s.code === 'KN');
    await request(t.http).patch(`/v1/admin/states/${kano.id}`).set(ops.headers).send({ enabled: false }).expect(403);
    await request(t.http)
      .patch(`/v1/admin/states/${kano.id}`)
      .set(owner.headers)
      .send({ enabled: false, agentSignups: 'waitlist' })
      .expect(200);
    expect((await config()).states.map((s: { code: string }) => s.code)).not.toContain('KN');
    await request(t.http)
      .patch(`/v1/admin/states/${kano.id}`)
      .set(owner.headers)
      .send({ enabled: true, agentSignups: 'open' })
      .expect(200);
    expect((await config()).states.map((s: { code: string }) => s.code)).toContain('KN');
  });
});
