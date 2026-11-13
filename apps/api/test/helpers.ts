import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MESSAGING, type MemoryMessagingAdapter } from '../src/adapters/messaging';
import { PUSH, type MemoryPushAdapter } from '../src/adapters/push';
import { DB, type Db } from '../src/db/database.module';
import { ERRAND_TIMERS, type MemoryErrandTimers } from '../src/timers/errand-timers';
import { RECURRING_JOBS, type MemoryRecurringJobs } from '../src/timers/recurring-jobs';
import { PAYMENTS, type FakePaymentsAdapter } from '../src/adapters/payments';
import { deposits } from '../src/db/schema';
import { eq } from 'drizzle-orm';
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
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error'], rawBody: true }));
  await app.listen(0, '127.0.0.1');
  return {
    app,
    http: app.getHttpServer(),
    url: await app.getUrl(),
    db: app.get(DB),
    messaging: app.get(MESSAGING),
    push: app.get(PUSH),
    timers: app.get(ERRAND_TIMERS),
    jobs: app.get(RECURRING_JOBS),
    payments: app.get(PAYMENTS),
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
  options: { phone?: string; firstName?: string | null; ip?: string } = {},
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

export async function act(
  t: TestApp,
  person: Person,
  errandId: string,
  event: string,
  data: Record<string, unknown> = {},
  status = 200,
) {
  const res = await request(t.http).post(`/v1/errands/${errandId}/events`).set(person.headers).send({ event, data });
  if (res.status !== status) {
    throw new Error(`${event}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** Delivers a signed provider webhook to the API, as Paystack would. */
export function deliverWebhook(t: TestApp, hook: { body: Buffer; signature: string }) {
  return request(t.http)
    .post('/v1/webhooks/paystack')
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
