import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { CountrySettingsSchema, type CountrySettings } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { admins, categories, countries, settingsVersions, states } from '../db/schema';
import { badRequest, conflict, notFound } from '../common/errors';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';

/** One changed setting, by its dotted path, e.g. fees.commissionBps.gold. */
export interface SettingChange {
  path: string;
  from: unknown;
  to: unknown;
}

/** Every leaf value by its dotted path. Lists are compared whole. */
function flatten(value: unknown, prefix = '', out = new Map<string, unknown>()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

export function settingChanges(before: unknown, after: unknown): SettingChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .filter((p) => JSON.stringify(a.get(p) ?? null) !== JSON.stringify(b.get(p) ?? null))
    .map((p) => ({ path: p, from: a.get(p) ?? null, to: b.get(p) ?? null }));
}

/** Country settings, categories and states. Changing them is for owners; every change is audited. */
@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async country(code: string) {
    const [c] = await this.db.select().from(countries).where(eq(countries.code, code));
    if (!c) throw notFound('country_not_found', 'Country not found');
    return c;
  }

  /** The current settings, and every saved version with what it changed and who saved it. */
  async settings(code: string) {
    await this.country(code);
    const versions = await this.db
      .select({
        version: settingsVersions.version,
        data: settingsVersions.data,
        createdAt: settingsVersions.createdAt,
        createdBy: admins.name,
      })
      .from(settingsVersions)
      .leftJoin(admins, eq(admins.id, settingsVersions.createdBy))
      .where(eq(settingsVersions.countryCode, code))
      .orderBy(desc(settingsVersions.version));
    const current = versions[0];
    if (!current) throw notFound('settings_missing', `No settings saved for ${code}`);
    // Every version read through the schema, so fields added since an old version was saved count as their
    // defaults there, and only real edits show as changes.
    const read = versions.map((v) => CountrySettingsSchema.parse(v.data));
    return {
      version: current.version,
      // Read through the schema, so fields added since a version was saved show their defaults.
      settings: read[0],
      history: versions.map((v, i) => ({
        version: v.version,
        createdAt: v.createdAt,
        createdBy: v.createdBy ?? (v.version === 1 ? 'Launch settings' : null),
        changes: read[i + 1] ? settingChanges(read[i + 1], read[i]) : [],
      })),
    };
  }

  /**
   * Saves new settings as the next version. Errands already running keep the version they started under;
   * new errands use this one. `basedOn` is the version the admin edited, so two owners editing at once
   * can't overwrite each other.
   */
  async saveSettings(admin: AdminContext, code: string, input: { basedOn: number; settings: unknown; note: string }) {
    const parsed = CountrySettingsSchema.safeParse(input.settings);
    if (!parsed.success) {
      throw badRequest('invalid_settings', 'Some settings are not valid', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    await this.country(code);
    return this.db.transaction(async (tx) => {
      const [latest] = await tx
        .select()
        .from(settingsVersions)
        .where(eq(settingsVersions.countryCode, code))
        .orderBy(desc(settingsVersions.version))
        .limit(1)
        .for('update');
      if (!latest) throw notFound('settings_missing', `No settings saved for ${code}`);
      if (latest.version !== input.basedOn) {
        throw conflict('settings_changed', 'Someone saved newer settings. Reload and make your change again.', {
          version: latest.version,
        });
      }
      const changes = settingChanges(CountrySettingsSchema.parse(latest.data), parsed.data);
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
      const [taken] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(eq(categories.countryCode, input.country), eq(categories.key, input.key), isNull(categories.deletedAt)),
        );
      if (taken) throw conflict('category_exists', 'Another category already uses this key');
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

  /** Removes a category for good. Its key is freed; errands that used it keep showing it by key. */
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
