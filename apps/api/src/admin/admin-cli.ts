import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadConfig } from '../config/app-config';
import * as schema from '../db/schema';
import { ADMIN_ROLES, admins, type AdminRole } from '../db/schema';
import { AdminAuthService, normaliseEmail } from './admin-auth.service';

const USAGE = `Jiffo admin accounts, from the server.

  invite --email <email> --name <name> --role <${ADMIN_ROLES.join('|')}>
      Adds a teammate and prints their invite link. Use it to make the first owner;
      after that, owners invite people from the panel.

  reset --email <email>
      Clears a teammate's password and authenticator app and prints a new invite link.
      For when the only owner has lost their phone or password.
`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
  });
  const command = positionals[0];
  const email = values.email ? normaliseEmail(values.email) : '';
  if ((command !== 'invite' && command !== 'reset') || !email.includes('@')) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema });
  const auth = new AdminAuthService(db, config);
  try {
    if (command === 'invite') {
      const role = values.role as AdminRole;
      if (!values.name?.trim() || !ADMIN_ROLES.includes(role)) {
        process.stdout.write(USAGE);
        process.exitCode = 1;
        return;
      }
      const invite = await db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
        if (existing) throw new Error(`${email} is already on the team. Use reset instead.`);
        const [admin] = await tx
          .insert(admins)
          .values({ email, name: values.name!.trim(), role })
          .returning({ id: admins.id });
        return auth.issueInvite(tx, admin!.id);
      });
      process.stdout.write(
        `Invited ${email} as ${role}. Send them this link (it works for ${invite.expiresInHours} hours):\n${invite.inviteUrl}` +
          '\n',
      );
    } else {
      const invite = await db.transaction(async (tx) => {
        const [admin] = await tx.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
        if (!admin) throw new Error(`${email} is not on the team`);
        await tx
          .update(admins)
          .set({ status: 'invited', passwordHash: null, totpCipher: null, totpEnabledAt: null, totpLastStep: null })
          .where(eq(admins.id, admin.id));
        await auth.revokeAll(tx, admin.id, 'reset');
        return auth.issueInvite(tx, admin.id);
      });
      process.stdout.write(
        `Reset ${email}. Send them this link (it works for ${invite.expiresInHours} hours):\n${invite.inviteUrl}` +
          '\n',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
