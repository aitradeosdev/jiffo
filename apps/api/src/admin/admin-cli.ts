import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { keyFor } from '../common/keys';
import { loadConfig } from '../config/app-config';
import { useFieldKey } from '../db/fields';
import * as schema from '../db/schema';
import { ADMIN_ROLES, admins } from '../db/schema';
import { isAdminRole } from '@jiffo/shared';
import { PasskeysService } from './passkeys.service';
import { AdminAuthService, normaliseEmail } from './admin-auth.service';

const USAGE = `Jiffo admin accounts, from the server.

  invite --email <email> --name <name> --role <${ADMIN_ROLES.join('|')}>
      Adds a teammate and prints their invite link. Use it to make the first owner;
      after that, owners invite people from the panel.

  reset --email <email>
      Clears a teammate's password and authenticator app and prints a new invite link.
      For when the only owner has lost their phone or password.

  derived-keys
      Prints the ID_FINGERPRINT_KEY, ADMIN_TOTP_KEY and FIELD_KEY a server without them derives from
      PIN_KEY. A deployment that already has data sets these, so its ID fingerprints, authenticators and
      personal details stay readable; a new one generates fresh keys instead.
`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
  });
  const command = positionals[0];
  if (command === 'derived-keys') {
    // Read before the full config, which in production refuses to load without these keys.
    const pin = process.env.PIN_KEY ?? '';
    if (!/^[0-9a-f]{64}$/i.test(pin)) throw new Error('PIN_KEY must be set (64 hex characters)');
    const from = { PIN_KEY: pin };
    process.stdout.write(
      `ID_FINGERPRINT_KEY=${keyFor(from, 'idFingerprint').toString('hex')}\n` +
        `ADMIN_TOTP_KEY=${keyFor(from, 'adminTotp').toString('hex')}\n` +
        `FIELD_KEY=${keyFor(from, 'fields').toString('hex')}\n`,
    );
    return;
  }
  const email = values.email ? normaliseEmail(values.email) : '';
  if ((command !== 'invite' && command !== 'reset') || !email.includes('@')) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  useFieldKey(keyFor(config, 'fields'));
  const db = drizzle(pool, { schema });
  const auth = new AdminAuthService(db, config, new PasskeysService(db, config));
  try {
    if (command === 'invite') {
      const role = values.role ?? '';
      if (!values.name?.trim() || !isAdminRole(role)) {
        process.stdout.write(USAGE);
        process.exitCode = 1;
        return;
      }
      const invite = await db.transaction((tx) =>
        auth.addAdmin(tx, { email, name: values.name!, role, invitedBy: null }),
      );
      process.stdout.write(
        `Invited ${email} as ${role}. Send them this link (it works for ${invite.expiresInHours} hours):\n${invite.inviteUrl}\n`,
      );
    } else {
      const invite = await db.transaction(async (tx) => {
        const [admin] = await tx.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
        if (!admin) throw new Error(`${email} is not on the team`);
        return auth.resetAccess(tx, admin.id);
      });
      process.stdout.write(
        `Reset ${email}. Send them this link (it works for ${invite.expiresInHours} hours):\n${invite.inviteUrl}\n`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The shared helpers refuse with API errors; print their message, not the HTTP wrapper's.
  const body = (error as { getResponse?: () => { error?: { message?: string } } }).getResponse?.();
  console.error(body?.error?.message ?? (error instanceof Error ? error.message : error));
  process.exit(1);
});
