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
import type { AppName } from '../src/db/schema';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  url: string;
  db: Db;
  messaging: MemoryMessagingAdapter;
  push: MemoryPushAdapter;
  timers: MemoryErrandTimers;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error'] }));
  await app.listen(0, '127.0.0.1');
  return {
    app,
    http: app.getHttpServer(),
    url: await app.getUrl(),
    db: app.get(DB),
    messaging: app.get(MESSAGING),
    push: app.get(PUSH),
    timers: app.get(ERRAND_TIMERS),
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
