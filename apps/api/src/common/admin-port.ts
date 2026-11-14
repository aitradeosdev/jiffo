import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/*
 * The admin API on its own address (docs/security-plan.md, D1). With ADMIN_API_PORT set, the admin routes
 * answer only on that port, which is put behind the team's access control (single sign-on, say) and not on
 * the open internet, and every other route answers only on the public port.
 */

/**
 * The path as Express would route it: case and repeated slashes don't matter to it, so not here either, and
 * a full address in the request line (GET http://host/v1/admin/me) is routed by its path.
 */
function routedPath(url: string) {
  let path = url;
  if (!path.startsWith('/')) {
    try {
      path = new URL(path).pathname;
    } catch {
      // Not an address: as sent.
    }
  }
  path = path.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    // Left as sent: Express can't route a broken escape either.
  }
  return path.replace(/\/{2,}/g, '/').toLowerCase();
}

/** Whether a request is for the admin API: anything under /<prefix>/admin. */
export const isAdminPath = (url: string, prefix: string) => new RegExp(`^/${prefix}/admin(/|$)`).test(routedPath(url));

/** The load balancer's check answers on both ports. */
const isHealth = (url: string) => /^\/health\/?$/.test(routedPath(url));

/** Keeps each port to its own routes; anything else is not found there. */
export function adminPortOnly(adminPort: number, prefix: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const onAdminPort = req.socket.localPort === adminPort;
    const admin = isAdminPath(req.originalUrl, prefix);
    if (isHealth(req.originalUrl) || (onAdminPort ? admin : !admin)) return next();
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  };
}

/** Opens the admin port on the same app; it closes with the app's own server. */
export function listenAdmin(app: INestApplication, port: number, host?: string): Promise<Server> {
  const server = createServer(app.getHttpAdapter().getInstance());
  (app.getHttpServer() as Server).once('close', () => server.close());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
