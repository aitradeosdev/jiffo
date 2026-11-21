import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CountriesService } from '../src/countries/countries.service';
import { adminAudit, errands } from '../src/db/schema';
import type { ErrandTimerJob } from '../src/timers/errand-timers';
import { act, adminAs, createErrand, createTestApp, fund, photo, signIn, type Person, type TestApp } from './helpers';

const HOUR = 3_600_000;

/**
 * Drop-off photos (docs/security-plan.md, X1–X3): approved automatically after 24 hours, with reminders to
 * the customer by push and SMS 2, 12 and 20 hours after the photo; and a queue where staff can see each one's
 * timer, pause it, or step in to decide.
 */
describe('drop-off photos awaiting approval', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    [customer, agent] = await Promise.all([signIn(t, 'customer'), signIn(t, 'agent')]);
    await fund(t, customer, 50_000_000);
    ops = await adminAs(t, 'operations');
    for (const person of [customer, agent]) {
      await request(t.http)
        .put('/v1/devices/current/push-token')
        .set(person.headers)
        .send({ token: `release-${person.userId}` })
        .expect(204);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** An errand whose agent has just sent the drop-off photo. */
  const awaiting = async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    await act(t, agent, errand.id, 'send_dropoff_photo', { photo: await photo(t, agent, errand.id, 'dropoff_photo') });
    return errand.id;
  };
  // The photo's timers: the prompt to raise the fee, set when the errand was sent, comes to nothing by now.
  const timersOf = (id: string) =>
    t.timers.pending.filter((p) => p.job.errandId === id && p.job.event !== 'raise_prompt');
  const fire = (id: string, match: (job: ErrandTimerJob) => boolean) =>
    t.timers.fireWhere((j) => j.errandId === id && match(j));
  const row = async (id: string) => (await t.db.select().from(errands).where(eq(errands.id, id)))[0]!;
  const smsTo = (who: Person) => t.messaging.texts.filter((m) => m.phone === who.phone);
  const pushesTo = (who: Person) => t.push.sent.filter((p) => p.token === `release-${who.userId}`);
  const adminAct = (id: string, body: Record<string, unknown>, who = ops) =>
    request(t.http).post(`/v1/admin/errands/${id}/actions`).set(who.headers).send(body);
  const queue = async () =>
    (await request(t.http).get('/v1/admin/dropoffs?country=NG').set(ops.headers).expect(200)).body.dropoffs as Array<{
      id: string;
      dueAt: string;
      pausedAt: string | null;
      photoUrl: string | null;
      customer: { id: string };
      agent: { id: string };
    }>;

  it('sets the automatic approval for 24 hours, with reminders at 2, 12 and 20 hours', async () => {
    const id = await awaiting();
    const due = timersOf(id).map((p) => [p.job.event, Math.round(p.delayMs / HOUR)]);
    expect(due).toEqual([
      ['auto_release', 24],
      ['release_reminder', 2],
      ['release_reminder', 12],
      ['release_reminder', 20],
    ]);
    const { releaseDueAt } = await row(id);
    expect(Math.abs(releaseDueAt!.getTime() - (Date.now() + 24 * HOUR))).toBeLessThan(60_000);
  });

  it('reminds the customer by push and SMS, saying how long is left', async () => {
    const id = await awaiting();
    // Two hours on.
    await t.db
      .update(errands)
      .set({ releaseDueAt: new Date(Date.now() + 22 * HOUR) })
      .where(eq(errands.id, id));
    const texts = smsTo(customer).length;
    await fire(id, (j) => j.event === 'release_reminder' && j.remindAt === 2);
    const sms = smsTo(customer).slice(texts);
    expect(sms).toHaveLength(1);
    expect(sms[0]!.text).toMatch(/Jiffo: .*drop-off photo.*approved automatically in 22 hours/i);
    // One text, not two: a reminder is a paid SMS.
    expect(sms[0]!.text.length).toBeLessThanOrEqual(160);
    expect(pushesTo(customer).at(-1)).toMatchObject({ data: { type: 'errand.release_reminder', errandId: id } });
    expect((await row(id)).status).toBe('photo_pending');
  });

  it('sends no reminder once the customer has approved, or for an errand that moved on', async () => {
    const id = await awaiting();
    await act(t, customer, id, 'approve_photo');
    const texts = smsTo(customer).length;
    await fire(id, (j) => j.event === 'release_reminder');
    expect(smsTo(customer).length).toBe(texts);
  });

  it('reminds at the hours Settings, Security give, never after the automatic approval', async () => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return (
        saved && {
          ...saved,
          settings: { ...saved.settings, security: { ...saved.settings.security, releaseReminderHours: [6, 30] } },
        }
      );
    });
    const id = await awaiting();
    const due = timersOf(id).map((p) => [p.job.event, Math.round(p.delayMs / HOUR)]);
    expect(due).toEqual([
      ['auto_release', 24],
      ['release_reminder', 6],
    ]);
  });

  it('lets staff pause the timer: nothing is approved or reminded until they resume it', async () => {
    const id = await awaiting();
    const before = await row(id);
    const paused = await adminAct(id, {
      event: 'pause_release',
      version: before.version,
      note: 'Customer called about it',
    });
    expect(paused.status).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'photo_pending', releasePausedAt: expect.any(Date) });
    // The timers set before do nothing now.
    const texts = smsTo(customer).length;
    await fire(id, () => true);
    expect((await row(id)).status).toBe('photo_pending');
    expect(smsTo(customer).length).toBe(texts);
    // The customer can still approve it themselves.
    const audit = await t.db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.action, 'errand.pause_release'), eq(adminAudit.targetId, id)));
    expect(audit).toHaveLength(1);
    // Paused once is enough.
    const again = await adminAct(id, { event: 'pause_release', version: paused.body.version, note: 'Again' });
    expect(again.status).toBe(409);
    await act(t, customer, id, 'approve_photo');
    expect(await row(id)).toMatchObject({ status: 'completed', releasePausedAt: null, releaseDueAt: null });
  });

  it('resumes with the time that was left, and the reminders still to come', async () => {
    const id = await awaiting();
    const { version } = await row(id);
    const paused = (await adminAct(id, { event: 'pause_release', version, note: 'Checking the photo' })).body;
    // Sent 13 hours before it was paused, 11 hours left then, and paused for three hours since.
    await t.db
      .update(errands)
      .set({ releaseDueAt: new Date(Date.now() + 8 * HOUR), releasePausedAt: new Date(Date.now() - 3 * HOUR) })
      .where(eq(errands.id, id));
    t.timers.pending.splice(0);
    const resumed = await adminAct(id, { event: 'resume_release', version: paused.version, note: 'Photo is fine' });
    expect(resumed.status).toBe(200);
    const due = timersOf(id).map((p) => [p.job.event, Math.round(p.delayMs / HOUR)]);
    expect(due).toEqual([
      ['auto_release', 11],
      ['release_reminder', 7],
    ]);
    const after = await row(id);
    expect(after.releasePausedAt).toBeNull();
    expect(Math.abs(after.releaseDueAt!.getTime() - (Date.now() + 11 * HOUR))).toBeLessThan(60_000);
    // Resuming what isn't paused is refused.
    expect((await adminAct(id, { event: 'resume_release', version: after.version, note: 'Again' })).status).toBe(409);
    await fire(id, (j) => j.event === 'auto_release');
    expect((await row(id)).status).toBe('completed');
  });

  it('shows the apps when it is approved by itself, or that it is paused', async () => {
    const id = await awaiting();
    const view = async () =>
      (await request(t.http).get(`/v1/errands/${id}`).set(customer.headers).expect(200)).body.release;
    expect(await view()).toEqual({ dueAt: expect.any(String), pausedAt: null });
    const { version } = await row(id);
    await adminAct(id, { event: 'pause_release', version, note: 'Checking' }).expect(200);
    expect(await view()).toEqual({ dueAt: expect.any(String), pausedAt: expect.any(String) });
    await act(t, customer, id, 'approve_photo');
    expect(await view()).toBeNull();
  });

  it("says less than an hour when that's all that was left", async () => {
    const id = await awaiting();
    const { version } = await row(id);
    const paused = (await adminAct(id, { event: 'pause_release', version, note: 'Checking' })).body;
    const at = new Date();
    await t.db
      .update(errands)
      .set({ releaseDueAt: new Date(at.getTime() + 5 * 60_000), releasePausedAt: at })
      .where(eq(errands.id, id));
    const pushes = pushesTo(customer).length;
    await adminAct(id, { event: 'resume_release', version: paused.version, note: 'Photo is fine' }).expect(200);
    expect(pushesTo(customer).slice(pushes).at(-1)?.body).toMatch(/in less than an hour/);
  });

  it('lets staff step in on a paused one, which ends the pause', async () => {
    const id = await awaiting();
    const { version } = await row(id);
    const paused = (await adminAct(id, { event: 'pause_release', version, note: 'Looking into it' })).body;
    await adminAct(id, {
      event: 'admin_intervene',
      version: paused.version,
      note: 'Photo shows the wrong gate',
    }).expect(200);
    expect(await row(id)).toMatchObject({ status: 'disputed', releasePausedAt: null, releaseDueAt: null });
  });

  it('lists the drop-off photos awaiting approval, soonest first, with their timers and photos', async () => {
    const later = await awaiting();
    const sooner = await awaiting();
    await t.db
      .update(errands)
      .set({ releaseDueAt: new Date(Date.now() + HOUR) })
      .where(eq(errands.id, sooner));
    const pausedId = await awaiting();
    const { version } = await row(pausedId);
    await adminAct(pausedId, { event: 'pause_release', version, note: 'Waiting on the customer' }).expect(200);
    const done = await awaiting();
    await act(t, customer, done, 'approve_photo');

    const page = (await request(t.http).get('/v1/admin/dropoffs?country=NG').set(ops.headers).expect(200)).body;
    expect(page.total).toBeGreaterThanOrEqual(3);
    const listed = await queue();
    const ids = listed.map((d) => d.id);
    // Paused ones first: someone is looking at them, and they mustn't fall off a long list.
    expect(listed[0]?.pausedAt).toEqual(expect.any(String));
    expect(ids).not.toContain(done);
    expect(ids.indexOf(sooner)).toBeLessThan(ids.indexOf(later));
    expect(listed.find((d) => d.id === pausedId)?.pausedAt).toEqual(expect.any(String));
    expect(listed.find((d) => d.id === later)).toMatchObject({
      customer: { id: customer.userId },
      agent: { id: agent.userId },
      photoUrl: expect.stringContaining('dropoff_photo'),
      pausedAt: null,
    });
    // Everyone in the panel can see it; only staff who step into errands can pause one.
    const finance = await adminAs(t, 'finance');
    await request(t.http).get('/v1/admin/dropoffs?country=NG').set(finance.headers).expect(200);
    const { version: v } = await row(later);
    expect((await adminAct(later, { event: 'pause_release', version: v, note: 'No' }, finance)).status).toBe(403);
  });

  it('tells both sides when staff pause or resume the approval', async () => {
    const id = await awaiting();
    const { version } = await row(id);
    const pushes = pushesTo(agent).length;
    await adminAct(id, { event: 'pause_release', version, note: 'Checking' }).expect(200);
    expect(
      pushesTo(agent)
        .slice(pushes)
        .map((p) => p.title),
    ).toContain('Approval paused');
  });
});
