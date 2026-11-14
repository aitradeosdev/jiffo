import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { MemoryMessagingAdapter } from '../src/adapters/messaging';
import type { MemoryPushAdapter } from '../src/adapters/push';
import { DB, type Db } from '../src/db/database.module';
import { ERRAND_TIMERS, type MemoryErrandTimers } from '../src/timers/errand-timers';
import { RECURRING_JOBS, type MemoryRecurringJobs } from '../src/timers/recurring-jobs';
import type { FakePaymentsAdapter } from '../src/adapters/payments';
import type { FakeCallsAdapter } from '../src/adapters/calls';
import { ENV_ADAPTERS, type Adapters } from '../src/providers/env-adapters';
import {
  admins,
  adminSessions,
  agentApplications,
  customerVerifications,
  deposits,
  errands,
  errandStops,
  type AdminRole,
} from '../src/db/schema';
import { sha256 } from '../src/common/crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { AppName } from '../src/db/schema';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  url: string;
  db: Db;
  messaging: MemoryMessagingAdapter;
  push: MemoryPushAdapter;
  timers: MemoryErrandTimers;
  jobs: MemoryRecurringJobs;
  payments: FakePaymentsAdapter;
  calls: FakeCallsAdapter;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error'], rawBody: true }));
  await app.listen(0, '127.0.0.1');
  // The stand-ins behind each provider switch, while no provider is switched on in the panel.
  const env = app.get<Adapters>(ENV_ADAPTERS);
  return {
    app,
    http: app.getHttpServer(),
    url: await app.getUrl(),
    db: app.get(DB),
    messaging: env.sms as MemoryMessagingAdapter,
    push: env.push as MemoryPushAdapter,
    timers: app.get(ERRAND_TIMERS),
    jobs: app.get(RECURRING_JOBS),
    payments: env.payments as FakePaymentsAdapter,
    calls: env.calls as FakeCallsAdapter,
    close: () => app.close(),
  };
}

/** A valid Nigerian mobile number nobody else in the run is using. */
export const randomPhone = () => `+234803${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
/** Each test gets its own client IP, so per-IP limits in one test never affect another. */
export const randomIp = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 255)}`;

export interface Person {
  phone: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  headers: { Authorization: string };
}

export async function signIn(
  t: TestApp,
  app: AppName,
  options: { phone?: string; firstName?: string | null; ip?: string; unapproved?: boolean; unverified?: boolean } = {},
): Promise<Person> {
  const phone = options.phone ?? randomPhone();
  const ip = options.ip ?? randomIp();
  await request(t.http).post('/v1/auth/otp/request').set('x-forwarded-for', ip).send({ phone }).expect(200);
  const code = t.messaging.lastCodeFor(phone);
  const res = await request(t.http)
    .post('/v1/auth/otp/verify')
    .send({ phone, code, app, device: { key: randomUUID(), platform: 'android', name: 'Test phone' } })
    .expect(200);
  const person: Person = {
    phone,
    userId: res.body.user.id,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    headers: { Authorization: `Bearer ${res.body.accessToken}` },
  };
  // Test agents are approved, as if they had finished their application, unless a test says otherwise.
  if (app === 'agent' && !options.unapproved) {
    await t.db
      .insert(agentApplications)
      .values({ userId: person.userId, countryCode: 'NG', status: 'approved', decidedAt: new Date() })
      .onConflictDoNothing();
  }
  // Test customers are verified, as if they had checked their ID, unless a test says otherwise.
  if (app === 'customer' && !options.unverified) {
    await t.db
      .insert(customerVerifications)
      .values({
        userId: person.userId,
        status: 'verified',
        provider: 'fake',
        reference: `cid-${randomUUID()}`,
        idType: 'nin',
      })
      .onConflictDoNothing();
  }
  const firstName = options.firstName === undefined ? (app === 'customer' ? 'Ada' : 'Tunde') : options.firstName;
  if (firstName) await request(t.http).patch('/v1/me').set(person.headers).send({ firstName }).expect(200);
  return person;
}

/** Lekki to Victoria Island, Lagos. */
export const LAGOS_STOPS = [
  { kind: 'pickup', label: 'Shop', address: 'Admiralty Way, Lekki Phase 1, Lagos', lat: 6.4474, lng: 3.4723 },
  { kind: 'dropoff', label: 'Home', address: 'Adeola Odeku St, Victoria Island, Lagos', lat: 6.4311, lng: 3.4158 },
];

export function errandBody(overrides: Record<string, unknown> = {}) {
  return {
    categoryKey: 'parcel',
    stateCode: 'LA',
    description: 'Pick up a parcel from the front desk',
    feeKobo: 250_000,
    stops: LAGOS_STOPS,
    ...overrides,
  };
}

export async function createErrand(t: TestApp, customer: Person, overrides: Record<string, unknown> = {}) {
  const res = await request(t.http).post('/v1/errands').set(customer.headers).send(errandBody(overrides)).expect(201);
  return res.body as { id: string; status: string; version: number; buy: boolean; allowedEvents: string[] };
}

/** The agent's phone reports a position: the errand's drop-off, unless another place is given. */
export async function atDropoff(t: TestApp, agent: Person, errandId: string, at?: { lat: number; lng: number }) {
  const [stop] = await t.db
    .select({ lat: errandStops.lat, lng: errandStops.lng })
    .from(errandStops)
    .where(and(eq(errandStops.errandId, errandId), eq(errandStops.kind, 'dropoff')));
  await request(t.http)
    .put('/v1/agent/presence')
    .set(agent.headers)
    .send(at ?? { lat: stop!.lat, lng: stop!.lng })
    .expect(200);
}

/** The agent has waited at the drop-off as long as the settings ask before a photo may be sent. */
export async function waitedAtDropoff(t: TestApp, errandId: string) {
  await t.db
    .update(errands)
    .set({ deliveredAt: new Date(Date.now() - 24 * 3_600_000) })
    .where(eq(errands.id, errandId));
}

/**
 * Sends an errand event. As an agent's phone would, it reports the drop-off position before the hand-off
 * steps, and a photo is sent only after the wait: tests of those rules call the API themselves.
 */
export async function act(
  t: TestApp,
  person: Person,
  errandId: string,
  event: string,
  data: Record<string, unknown> = {},
  status = 200,
) {
  if (['mark_delivered', 'confirm_pin', 'send_dropoff_photo'].includes(event)) await atDropoff(t, person, errandId);
  if (event === 'send_dropoff_photo') await waitedAtDropoff(t, errandId);
  const res = await request(t.http).post(`/v1/errands/${errandId}/events`).set(person.headers).send({ event, data });
  if (res.status !== status) {
    throw new Error(`${event}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** Delivers a signed provider webhook to the API, as Paystack would. */
export function deliverWebhook(t: TestApp, hook: { body: Buffer; signature: string }) {
  return request(t.http)
    .post(`/v1/webhooks/${t.payments.name}`)
    .set('content-type', 'application/json')
    .set('x-paystack-signature', hook.signature)
    .send(hook.body.toString());
}

/** Tops up a customer's wallet the real way: a deposit, the transfer arriving, and the webhook. */
export async function fund(t: TestApp, person: Person, amountKobo = 5_000_000) {
  const res = await request(t.http).post('/v1/wallet/deposits').set(person.headers).send({ amountKobo }).expect(201);
  const [row] = await t.db.select().from(deposits).where(eq(deposits.id, res.body.id));
  await deliverWebhook(t, t.payments.pay(row!.reference)).expect(200);
  return res.body.id as string;
}

export async function balanceOf(t: TestApp, person: Person) {
  return (await request(t.http).get('/v1/wallet').set(person.headers).expect(200)).body;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** Uploads a small photo for an errand the way the apps do, and returns its key for an event or message. */
export async function photo(
  t: TestApp,
  person: Person,
  errandId: string,
  purpose: 'receipt' | 'item_photo' | 'dropoff_photo' | 'chat_photo',
) {
  const res = await request(t.http)
    .post('/v1/uploads')
    .set(person.headers)
    .send({ errandId, purpose, contentType: 'image/jpeg', size: JPEG.length })
    .expect(201);
  const url = new URL(res.body.upload.url);
  await request(t.http)
    .put(url.pathname + url.search)
    .set('content-type', 'image/jpeg')
    .send(JPEG)
    .expect(200);
  return res.body.key as string;
}

/** A signed-in admin of the given role, made directly in the database (the sign-in itself is tested in admin.e2e). */
export async function adminAs(t: TestApp, role: AdminRole) {
  const [admin] = await t.db
    .insert(admins)
    .values({
      email: `${randomUUID()}@jiffoapp.com`,
      name: `Test ${role}`,
      role,
      status: 'active',
      totpEnabledAt: new Date(),
    })
    .returning({ id: admins.id, name: admins.name });
  const token = randomUUID();
  await t.db
    .insert(adminSessions)
    .values({ adminId: admin!.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) });
  return { id: admin!.id, name: admin!.name, headers: { Authorization: `Bearer ${token}` } };
}

let serial = 0;
/**
 * Digits no other call in the run gets: the time to the millisecond and a counter. Test files run one after
 * another, so they never share a millisecond.
 */
export const uniqueDigits = (length: number) => {
  serial = (serial + 1) % 100;
  const stamp = String(Date.now() % 10 ** (length - 2)).padStart(length - 2, '0');
  return `${stamp}${String(serial).padStart(2, '0')}`;
};

/** A NIN nobody else in the run has, ending in the given digits; the fake provider decides by the ending. */
export const uniqueNin = (ending = '4567') => `${uniqueDigits(7)}${ending}`;

/**
 * Fills in every step of an agent's application, short of sending it: basics, identity, address, a payout
 * account, preferences and the terms. The agent's name must be Tunde Bakare, as the fake provider's record is.
 */
export async function completeApplication(t: TestApp, agent: Person, nin = uniqueNin()) {
  const call = (method: 'post' | 'put' | 'patch', path: string, body: Record<string, unknown> = {}) =>
    request(t.http)[method](`/v1/agent/application${path}`).set(agent.headers).send(body);
  await call('patch', '', { stateCode: 'LA', area: 'Lekki' }).expect(200);
  const started = await call('post', '/identity', { nin, bvn: '22212345678', consent: true }).expect(200);
  // The app hands this to the provider's SDK.
  if (started.body.provider !== 'fake' || typeof started.body.sdkToken !== 'string') {
    throw new Error(`identity start: ${JSON.stringify(started.body)}`);
  }
  await call('post', '/identity/finish').expect(200);
  await call('put', '/address', {
    address: '14 Fola Osibo Road, Lekki Phase 1',
    emergency: { name: 'Ngozi Bakare', phone: '+2348034471902', relationship: 'Sibling' },
  }).expect(200);
  const accountNumber = `0${uniqueDigits(9)}`;
  t.payments.accounts.set(`058:${accountNumber}`, 'TUNDE BAKARE');
  await request(t.http)
    .put('/v1/payout-account')
    .set(agent.headers)
    .send({ bankCode: '058', accountNumber })
    .expect(200);
  await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ takesPurchases: true }).expect(200);
  await call('post', '/terms', { accepted: true }).expect(200);
  return nin;
}

/**
 * A nightly check in a test sees the whole run's ledger but only this file's fake provider, so it reports a
 * shortfall that would pause instant withdrawals for the files after it. Tests that run one clear it after.
 */
export async function clearReconciliationPauses(t: TestApp) {
  await t.db.execute(
    sql`update reconciliation_runs set cleared_at = now(), clear_note = 'test' where cleared_at is null`,
  );
}

/** An approved agent with a payout account in their own name and money to withdraw, given by an adjustment. */
export async function agentWithMoney(t: TestApp, amountKobo = 1_000_000) {
  const agent = await signIn(t, 'agent', { firstName: 'Tunde' });
  await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
  const accountNumber = `0${uniqueDigits(9)}`;
  t.payments.accounts.set(`058:${accountNumber}`, 'TUNDE BAKARE');
  await request(t.http)
    .put('/v1/payout-account')
    .set(agent.headers)
    .send({ bankCode: '058', accountNumber })
    .expect(200);
  const finance = await adminAs(t, 'finance');
  await request(t.http)
    .post('/v1/admin/money/adjustments')
    .set(finance.headers)
    .send({
      personId: agent.userId,
      account: 'agent_available',
      direction: 'credit',
      amountKobo,
      note: 'Test earnings to withdraw',
      requestId: randomUUID(),
    })
    .expect(200);
  return agent;
}
