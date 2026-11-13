import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  CUSTOMER_ID_TYPES,
  CountrySettingsSchema,
  ID_TYPES,
  settingChanges,
  type CountrySettings,
} from '@jiffo/shared';
import { IdentityChecksService } from '../identity/identity-checks.service';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { admins, categories, settingsVersions, states } from '../db/schema';
import { badRequest, conflict, notFound } from '../common/errors';
import { AuditService } from './audit.service';
import { requireCountry } from './countries';
import type { AdminContext } from './admin.types';

/** How many versions the settings page lists. */
const HISTORY = 50;

const issuesOf = (error: { issues: Array<{ path: Array<string | number>; message: string }> }) =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** Country settings, categories and states. Changing them is for owners; every change is audited. */
@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly identity: IdentityChecksService,
  ) {}

  private country(code: string) {
    return requireCountry(this.db, code);
  }

  /**
   * The current settings, and the latest versions with what each changed and who saved it. Versions are read
   * through the schema, so fields added since one was saved count as their defaults; a version that breaks a
   * rule added later is shown as stored, with its problems, rather than taking the page down.
   */
  async settings(code: string) {
    await this.country(code);
    const rows = await this.db
      .select({
        version: settingsVersions.version,
        data: settingsVersions.data,
        createdAt: settingsVersions.createdAt,
        createdBy: admins.name,
      })
      .from(settingsVersions)
      .leftJoin(admins, eq(admins.id, settingsVersions.createdBy))
      .where(eq(settingsVersions.countryCode, code))
      .orderBy(desc(settingsVersions.version))
      // The newest HISTORY versions, plus one more to tell what the oldest of them changed.
      .limit(HISTORY + 1);
    const current = rows[0];
    if (!current) throw notFound('settings_missing', `No settings saved for ${code}`);
    const read = rows.map((v) => {
      const parsed = CountrySettingsSchema.safeParse(v.data);
      return parsed.success ? { data: parsed.data, problems: [] } : { data: v.data, problems: issuesOf(parsed.error) };
    });
    return {
      version: current.version,
      settings: read[0]!.data,
      /** Rules the current version breaks, if the schema has grown stricter since it was saved. */
      problems: read[0]!.problems,
      history: rows.slice(0, HISTORY).map((v, i) => ({
        version: v.version,
        createdAt: v.createdAt,
        createdBy: v.createdBy ?? (v.version === 1 ? 'Launch settings' : null),
        changes: read[i + 1] ? settingChanges(read[i + 1]!.data, read[i]!.data) : [],
      })),
    };
  }

  /**
   * Saves new settings as the next version. Errands already running keep the version they started under;
   * new errands use this one. `basedOn` is the version the admin edited, so two owners editing at once
   * can't overwrite each other.
   */
  async saveSettings(admin: AdminContext, code: string, input: { basedOn: number; settings: unknown; note: string }) {
    // Customers verify with a number and a selfie: an ID document for them is refused, not quietly dropped.
    const asked = (input.settings as { identity?: { customerIdTypes?: unknown } } | null)?.identity?.customerIdTypes;
    if (Array.isArray(asked) && asked.some((t) => !(CUSTOMER_ID_TYPES as readonly unknown[]).includes(t))) {
      throw badRequest('invalid_settings', 'Some settings are not valid', {
        issues: [
          {
            path: 'identity.customerIdTypes',
            message: 'Customers verify with their NIN or BVN and a selfie; ID documents are for agents',
          },
        ],
      });
    }
    const parsed = CountrySettingsSchema.safeParse(input.settings);
    if (!parsed.success) {
      throw badRequest('invalid_settings', 'Some settings are not valid', { issues: issuesOf(parsed.error) });
    }
    // Each side must keep an ID the identity provider in use checks, or nobody on it could verify.
    for (const role of ['customer', 'agent'] as const) {
      const options = this.identity.options(role, parsed.data.identity);
      if (options.adapter.name !== 'none' && options.idTypes.length === 0) {
        const name = options.providerName ?? 'The identity provider in use';
        const checks = options.adapter.idTypes.map((t) => ID_TYPES[t].name).join(', ');
        throw badRequest('invalid_settings', 'Some settings are not valid', {
          issues: [
            {
              path: `identity.${role}IdTypes`,
              message: `${name} checks ${checks}${role === 'agent' && options.withBvn && !options.adapter.bvnAlongside ? ', and with the BVN rule on takes the BVN as the ID' : ''}. Keep one of those for ${role}s, or nobody can verify.`,
            },
          ],
        });
      }
    }
    await this.country(code);
    return this.db.transaction(async (tx) => {
      // One save at a time per country: a second save made at the same moment then sees the first's version.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'settings:' + code}))`);
      const [latest] = await tx
        .select()
        .from(settingsVersions)
        .where(eq(settingsVersions.countryCode, code))
        .orderBy(desc(settingsVersions.version))
        .limit(1);
      if (!latest) throw notFound('settings_missing', `No settings saved for ${code}`);
      if (latest.version !== input.basedOn) {
        throw conflict('settings_changed', 'Someone saved newer settings. Reload and make your change again.', {
          version: latest.version,
        });
      }
      const before = CountrySettingsSchema.safeParse(latest.data);
      const changes = settingChanges(before.success ? before.data : latest.data, parsed.data);
      if (changes.length === 0) return { version: latest.version, changes };
      const version = latest.version + 1;
      await tx.insert(settingsVersions).values({
        countryCode: code,
        version,
        data: parsed.data as CountrySettings,
        createdBy: admin.adminId,
      });
      await this.audit.record(tx, admin, {
        action: 'settings.save',
        targetType: 'settings',
        targetId: `${code}:${version}`,
        countryCode: code,
        data: { version, note: input.note, changes },
      });
      return { version, changes };
    });
  }

  /* ---------- Categories ---------- */

  async categories(code: string) {
    await this.country(code);
    return this.db
      .select()
      .from(categories)
      .where(and(eq(categories.countryCode, code), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sort), asc(categories.name));
  }

  async createCategory(
    admin: AdminContext,
    input: {
      country: string;
      key: string;
      name: string;
      icon: string;
      description: string;
      buyDefault: boolean;
      sort: number;
    },
  ) {
    await this.country(input.country);
    return this.db.transaction(async (tx) => {
      // One new category at a time per country, so two adds of the same key can't both pass the check.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'categories:' + input.country}))`);
      // A key is never reused, even after its category is removed: old errands and agents' saved
      // preferences still refer to it, and a new category under that key would quietly take them over.
      const [taken] = await tx
        .select({ deletedAt: categories.deletedAt })
        .from(categories)
        .where(and(eq(categories.countryCode, input.country), eq(categories.key, input.key)));
      if (taken) {
        throw conflict(
          taken.deletedAt ? 'key_used_before' : 'category_exists',
          taken.deletedAt
            ? 'A removed category used this key, and errands still refer to it. Choose another key.'
            : 'Another category already uses this key',
        );
      }
      const [row] = await tx
        .insert(categories)
        .values({
          countryCode: input.country,
          key: input.key,
          name: input.name,
          icon: input.icon,
          description: input.description,
          buyDefault: input.buyDefault,
          sort: input.sort,
        })
        .returning();
      await this.audit.record(tx, admin, {
        action: 'category.create',
        targetType: 'category',
        targetId: row!.id,
        countryCode: input.country,
        data: { key: input.key, name: input.name },
      });
      return row!;
    });
  }

  /** Changes a category. Switching one off hides it from new errands; errands already made keep it. */
  async updateCategory(
    admin: AdminContext,
    id: string,
    change: Partial<{
      name: string;
      icon: string;
      description: string;
      buyDefault: boolean;
      sort: number;
      active: boolean;
    }>,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
        .for('update');
      if (!before) throw notFound('category_not_found', 'Category not found');
      const [after] = await tx.update(categories).set(change).where(eq(categories.id, id)).returning();
      const changes = settingChanges(
        Object.fromEntries(Object.keys(change).map((k) => [k, before[k as keyof typeof before]])),
        change,
      );
      if (changes.length) {
        await this.audit.record(tx, admin, {
          action: 'category.update',
          targetType: 'category',
          targetId: id,
          countryCode: before.countryCode,
          data: { key: before.key, name: after!.name, changes },
        });
      }
      return after!;
    });
  }

  /** Removes a category for good. Its key stays reserved, since errands that used it still refer to it. */
  async deleteCategory(admin: AdminContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(categories)
        .set({ deletedAt: new Date(), active: false })
        .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
        .returning();
      if (!row) throw notFound('category_not_found', 'Category not found');
      await this.audit.record(tx, admin, {
        action: 'category.delete',
        targetType: 'category',
        targetId: id,
        countryCode: row.countryCode,
        data: { key: row.key, name: row.name },
      });
      return { deleted: true };
    });
  }

  /* ---------- States ---------- */

  async states(code: string) {
    await this.country(code);
    return this.db.select().from(states).where(eq(states.countryCode, code)).orderBy(asc(states.name));
  }

  /** Switches a state on or off for new errands, and opens agent sign-ups there or puts them on a waitlist. */
  async updateState(
    admin: AdminContext,
    id: string,
    change: Partial<{ enabled: boolean; agentSignups: 'open' | 'waitlist' }>,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(states).where(eq(states.id, id)).for('update');
      if (!before) throw notFound('state_not_found', 'State not found');
      const [after] = await tx.update(states).set(change).where(eq(states.id, id)).returning();
      const changes = settingChanges(
        Object.fromEntries(Object.keys(change).map((k) => [k, before[k as keyof typeof before]])),
        change,
      );
      if (changes.length) {
        await this.audit.record(tx, admin, {
          action: 'state.update',
          targetType: 'state',
          targetId: id,
          countryCode: before.countryCode,
          data: { code: before.code, name: before.name, changes },
        });
      }
      return after!;
    });
  }
}
