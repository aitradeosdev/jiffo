import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';

/**
 * Creates a throwaway database for this run, migrates it and points the tests at it.
 * DATABASE_URL must be a role that can create databases (the docker-compose and CI ones can).
 */
export default async function setup() {
  const base = new URL(process.env.DATABASE_URL ?? 'postgres://jiffo:jiffo@localhost:5432/jiffo');
  const name = `jiffo_test_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  await runMigrations(url.toString());

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    OTP_SECRET: randomBytes(32).toString('hex'),
    PIN_KEY: randomBytes(32).toString('hex'),
    MESSAGING_PROVIDER: 'memory',
    PUSH_PROVIDER: 'memory',
    TIMER_PROVIDER: 'memory',
    TRUST_PROXY_HOPS: '1',
    ADMIN_PANEL_SECRET: 'test-panel-secret-0123456789abcdef0123',
    SECURITY_CONTACT: 'mailto:security@jiffo.test',
    // Tests share one address and sign many people in a minute; the rate-limit test sets its own.
    RATE_LIMITS:
      'default=100000,paid=100000,board=100000,chat=100000,presence=100000,auth=100000,webhook=100000,socket=100000,ip=1000000',
  });

  return async () => {
    const cleanup = new Client({ connectionString: base.toString() });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await cleanup.end();
  };
}
