import { createServer, type Server } from 'node:net';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAdminPath, listenAdmin } from '../src/common/admin-port';
import { adminAs, createTestApp, type TestApp } from './helpers';

/** A port nothing is listening on. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe: Server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/**
 * The admin API on its own address (docs/security-plan.md, D1): with ADMIN_API_PORT set, admin routes answer
 * only there, and the apps' routes only on the public port, however the path is spelled.
 */
describe('the admin API on its own port', () => {
  let t: TestApp;
  let adminServer: HttpServer;
  let adminUrl: string;
  const before = process.env.ADMIN_API_PORT;
  beforeAll(async () => {
    const port = await freePort();
    process.env.ADMIN_API_PORT = String(port);
    t = await createTestApp();
    adminServer = await listenAdmin(t.app, port, '127.0.0.1');
    adminUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await t.close();
    if (before === undefined) delete process.env.ADMIN_API_PORT;
    else process.env.ADMIN_API_PORT = before;
  });

  it("refuses admin routes on the public port, however they're spelled", async () => {
    const owner = await adminAs(t, 'owner');
    for (const path of ['/v1/admin/me', '/V1/Admin/me', '//v1//admin/me', '/v1/%61dmin/me', '/v1/admin']) {
      const res = await request(t.http).get(path).set(owner.headers);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code, path).toBe('not_found');
    }
    await request(t.http).post('/v1/admin/auth/sign-in').send({ email: 'x@jiffoapp.com', password: 'x' }).expect(404);
    // The apps' routes are where they were.
    await request(t.http).get('/v1/config/NG').expect(200);
    await request(t.http).get('/health').expect(200);
  });

  it('refuses an admin route asked for with a full address on the public port', async () => {
    const owner = await adminAs(t, 'owner');
    const { port } = (t.http as HttpServer).address() as { port: number };
    // GET http://host/v1/admin/me: Express routes it by its path, so the split must too.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: 'http://api.jiffoapp.com/v1/admin/me', headers: owner.headers },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it('answers admin routes on the admin port, and nothing else', async () => {
    const owner = await adminAs(t, 'owner');
    expect((await request(adminUrl).get('/v1/admin/me').set(owner.headers).expect(200)).body).toMatchObject({
      role: 'owner',
    });
    await request(adminUrl).get('/v1/admin/me').expect(401);
    for (const path of ['/v1/config/NG', '/security', '/.well-known/security.txt', '/v1/administrator']) {
      expect((await request(adminUrl).get(path)).status, path).toBe(404);
    }
    await request(adminUrl).post('/v1/auth/otp/request').send({ phone: '+2348030000000' }).expect(404);
    await request(adminUrl).get('/health').expect(200);
    expect(adminServer.listening).toBe(true);
  });

  it('tells admin paths from the rest', () => {
    expect(isAdminPath('/v1/admin', 'v1')).toBe(true);
    expect(isAdminPath('/v1/admin/team?x=1', 'v1')).toBe(true);
    expect(isAdminPath('/v1/ADMIN/team', 'v1')).toBe(true);
    expect(isAdminPath('/v1/administrator', 'v1')).toBe(false);
    expect(isAdminPath('/v1/errands/admin', 'v1')).toBe(false);
    expect(isAdminPath('/v1/%zz/admin', 'v1')).toBe(false);
    expect(isAdminPath('http://api.jiffoapp.com/v1/admin/me', 'v1')).toBe(true);
    expect(isAdminPath('HTTP://API.JIFFOAPP.COM//V1/ADMIN', 'v1')).toBe(true);
  });
});
