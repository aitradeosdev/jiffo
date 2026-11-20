import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../src/common/canonical-json';
import { CountriesService } from '../src/countries/countries.service';
import { errandTrail } from '../src/db/schema';
import { EvidenceService } from '../src/errands/evidence.service';
import { TrailService } from '../src/agents/trail.service';
import {
  act,
  adminAs,
  createErrand,
  createTestApp,
  fund,
  LAGOS_STOPS,
  photo,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

interface Pack {
  id: string;
  reason: string;
  sha256: string;
  createdAt: string;
  content: Record<string, unknown> & {
    events: Array<{ event: string }>;
    messages: Array<{ body: string; senderRole: string }>;
    uploads: Array<{ purpose: string }>;
    calls: Array<{ callerRole: string }>;
    pinEntries: Array<{ event: string }>;
    trail: { points: number; mocked: number; sha256: string | null };
  };
}

/**
 * Each dispute's evidence pack (docs/security-plan.md, E8): made when the errand goes into dispute, fixed
 * from then on, with the chat, offers, receipts and photos, PIN entries, the call log and the GPS trail.
 */
describe('dispute evidence packs', () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  const page = async (errandId: string, who = ops) => {
    return (await request(t.http).get(`/v1/admin/errands/${errandId}`).set(who.headers).expect(200)).body;
  };
  const pack = async (errandId: string, packId: string) =>
    (await request(t.http).get(`/v1/admin/errands/${errandId}/evidence/${packId}`).set(ops.headers).expect(200))
      .body as Pack;
  const pickup = LAGOS_STOPS[0]!;

  /** An errand delivered, with a counter-offer, chat, a call, photos, a wrong PIN and positions on the way. */
  const disputed = async () => {
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer, 5_000_000);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'send_offer', { amountKobo: 300_000 });
    await act(t, customer, errand.id, 'decline_offer');
    await request(t.http)
      .post(`/v1/errands/${errand.id}/messages`)
      .set(customer.headers)
      .send({ body: 'Please bring it to the gate', clientId: randomUUID() })
      .expect(201);
    await request(t.http).post(`/v1/errands/${errand.id}/call`).set(customer.headers).expect(200);
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ lat: pickup.lat, lng: pickup.lng })
      .expect(200);
    await photo(t, agent, errand.id, 'item_photo');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    await request(t.http)
      .post(`/v1/errands/${errand.id}/events`)
      .set(agent.headers)
      .send({ event: 'confirm_pin', data: { pin: '0000' } });
    return { customer, agent, errand };
  };
  const openDispute = (who: Person, errandId: string) =>
    act(t, who, errandId, 'open_dispute', { reason: 'The parcel never came' });

  it('makes a pack when a dispute opens: chat, offers, photos, PIN entries, calls and the trail', async () => {
    const { customer, errand } = await disputed();
    await openDispute(customer, errand.id);
    const { evidence } = await page(errand.id);
    expect(evidence).toEqual([
      expect.objectContaining({ reason: 'open_dispute', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
    const { content } = await pack(errand.id, evidence[0].id);
    expect(content.events.map((e) => e.event)).toEqual(
      expect.arrayContaining([
        'create',
        'accept',
        'send_offer',
        'decline_offer',
        'start',
        'mark_delivered',
        'pin_wrong',
        'open_dispute',
      ]),
    );
    expect(content.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: 'Please bring it to the gate', senderRole: 'customer' }),
      ]),
    );
    expect(content.uploads.map((u) => u.purpose)).toEqual(['item_photo']);
    expect(content.calls).toEqual([expect.objectContaining({ callerRole: 'customer' })]);
    expect(content.pinEntries.map((e) => e.event)).toEqual(['pin_wrong']);
    // The trail itself is kept with the errand, for as long as G4 allows; the pack holds its fingerprint.
    expect(content.trail).toMatchObject({
      points: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(content.trail.points).toBeGreaterThanOrEqual(2);
  });

  it("can't be changed afterwards, and its fingerprint proves it", async () => {
    const { customer, errand } = await disputed();
    await openDispute(customer, errand.id);
    const [made] = (await page(errand.id)).evidence;
    const full = await pack(errand.id, made.id);
    // The fingerprint is of the pack as it was made: anyone can work it out again from what was downloaded.
    expect(createHash('sha256').update(canonicalJson(full.content)).digest('hex')).toBe(full.sha256);
    await expect(
      t.db.execute(sql`update dispute_evidence set content = '{}'::jsonb where id = ${made.id}`),
    ).rejects.toThrow(/append-only/);
    await expect(t.db.execute(sql`delete from dispute_evidence where id = ${made.id}`)).rejects.toThrow(/append-only/);
  });

  it('holds the errand as it was the moment the dispute opened, not what came after', async () => {
    const { customer, errand } = await disputed();
    await openDispute(customer, errand.id);
    await request(t.http)
      .post(`/v1/errands/${errand.id}/messages`)
      .set(customer.headers)
      .send({ body: 'Sent after the dispute opened', clientId: randomUUID() })
      .expect(201);
    const [made] = (await page(errand.id)).evidence;
    const { content } = await pack(errand.id, made.id);
    expect(content.messages.map((m) => m.body)).not.toContain('Sent after the dispute opened');
    expect((content.errand as { status: string }).status).toBe('disputed');
  });

  it('makes one whichever way the errand goes into dispute, staff stepping in too', async () => {
    const { errand } = await disputed();
    const view = await page(errand.id);
    await request(t.http)
      .post(`/v1/admin/errands/${errand.id}/actions`)
      .set(ops.headers)
      .send({ event: 'admin_intervene', version: view.errand.version, note: 'Customer called support' })
      .expect(200);
    expect((await page(errand.id)).evidence.map((e: { reason: string }) => e.reason)).toEqual(['admin_intervene']);
  });

  it("still opens the dispute when its pack can't be made, and says so", async () => {
    const { customer, errand } = await disputed();
    vi.spyOn(t.app.get(EvidenceService), 'take').mockRejectedValueOnce(new Error('database away'));
    await openDispute(customer, errand.id);
    const view = await page(errand.id);
    expect(view.errand.status).toBe('disputed');
    expect(view.evidence).toEqual([]);
    const [alert] = await t.db
      .execute<{ kind: string }>(
        sql`select kind from alerts where kind = 'evidence_failed' and dedupe_key = ${errand.id}`,
      )
      .then((r) => r.rows);
    expect(alert).toEqual({ kind: 'evidence_failed' });
  });

  it('makes one when too many wrong PINs freeze the errand', async () => {
    const { agent, errand } = await disputed();
    for (let i = 0; i < 5; i += 1) {
      await request(t.http)
        .post(`/v1/errands/${errand.id}/events`)
        .set(agent.headers)
        .send({ event: 'confirm_pin', data: { pin: '0000' } });
    }
    const { evidence } = await page(errand.id);
    expect(evidence.map((e: { reason: string }) => e.reason)).toEqual(['pin_locked']);
    const { content } = await pack(errand.id, evidence[0].id);
    expect(content.pinEntries.filter((e) => e.event === 'pin_wrong').length).toBeGreaterThanOrEqual(4);
  });

  it('lets staff who handle disputes take another, and anyone in the panel read them', async () => {
    const { customer, errand } = await disputed();
    await openDispute(customer, errand.id);
    await request(t.http)
      .post(`/v1/errands/${errand.id}/messages`)
      .set(customer.headers)
      .send({ body: 'Still waiting', clientId: randomUUID() });
    const support = await adminAs(t, 'support');
    expect((await request(t.http).post(`/v1/admin/errands/${errand.id}/evidence`).set(support.headers)).status).toBe(
      403,
    );
    const disputes = await adminAs(t, 'disputes');
    const taken = await request(t.http)
      .post(`/v1/admin/errands/${errand.id}/evidence`)
      .set(disputes.headers)
      .expect(201);
    expect(taken.body).toMatchObject({ reason: 'staff' });
    const { evidence } = await page(errand.id, support);
    expect(evidence.map((e: { reason: string }) => e.reason)).toEqual(['staff', 'open_dispute']);
    const later = await pack(errand.id, taken.body.id);
    expect(later.content.messages.map((m) => m.body)).toContain('Still waiting');
    // Another errand's pack isn't found through this one.
    const other = await disputed();
    expect(
      (await request(t.http).get(`/v1/admin/errands/${other.errand.id}/evidence/${taken.body.id}`).set(ops.headers))
        .status,
    ).toBe(404);
  });

  it('shows the call log and the trail on the errand page', async () => {
    const { errand } = await disputed();
    const view = await page(errand.id);
    expect(view.calls).toEqual([expect.objectContaining({ callerRole: 'customer' })]);
    expect(view.trail.points.length).toBeGreaterThanOrEqual(2);
    expect(view.trail.points[0]).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number), mocked: false });
  });

  it('keeps trails as long as Settings, Security say', async () => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return (
        saved && { ...saved, settings: { ...saved.settings, security: { ...saved.settings.security, trailDays: 30 } } }
      );
    });
    const { errand, agent } = await disputed();
    await t.db.insert(errandTrail).values({
      errandId: errand.id,
      agentId: agent.userId,
      lat: pickup.lat,
      lng: pickup.lng,
      at: sql`now() - interval '31 days'`,
    });
    // The test's agent arrives at the drop-off in an instant, which raised a jump flag: cleared here, as an
    // open flag holds the trail.
    await t.db.execute(sql`update risk_flags set status = 'cleared' where id in
      (select flag_id from risk_flag_errands where errand_id = ${errand.id})`);
    await t.app.get(TrailService).prune();
    const left = await t.db
      .select()
      .from(errandTrail)
      .where(sql`${errandTrail.errandId} = ${errand.id} and ${errandTrail.at} < now() - interval '30 days'`);
    expect(left).toEqual([]);
  });
});
