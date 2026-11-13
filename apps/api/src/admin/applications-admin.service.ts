import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { admins, agentApplications, states, users } from '../db/schema';
import { AgentApplicationService } from '../agents/application.service';
import { PushService } from '../push/push.service';
import { AuditService } from './audit.service';
import { requireCountry } from './countries';
import { containing, cursorOf, exactTime, idPrefix, parseCursor, phoneDigits } from './list-helpers';
import type { AdminContext } from './admin.types';

export const APPLICATION_STATUSES = ['review', 'checking', 'draft', 'approved', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Since when an application has been waiting: when it was sent, or, for one never sent, when it began.
 * Written with table names, as inside a select list Drizzle leaves columns unqualified and users has a
 * created_at too.
 */
const since = sql`coalesce("agent_applications"."submitted_at", "agent_applications"."created_at")`;

type Check = { key: string; outcome: string; note?: string };
/** Each check as support reads it. The agent app has its own words, addressed to the agent. */
const CHECK_LABELS: Record<string, string> = {
  nin: 'NIN matches their details',
  bvn: 'BVN matches their details',
  drivers_licence: "Driver's licence matches their details",
  voters_card: "Voter's card matches their details",
  passport: 'Passport matches their details',
  id_type: 'An ID we accept',
  selfie: 'Selfie matches the ID photo',
  age: '18 or older',
  name: 'Name in the app matches the ID',
  address: 'Address confirmed',
  bank: 'Bank account is in the name on the ID',
  duplicate: 'No other agent account on this ID',
};
const labelled = (checks: Check[]) => checks.map((c) => ({ ...c, label: CHECK_LABELS[c.key] ?? c.key }));

/**
 * Agent applications as support sees them: the provider's results and what the agent typed, never their
 * documents, which stay with the provider. Applications the checks couldn't settle wait here for a person.
 */
@Injectable()
export class ApplicationsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly push: PushService,
    private readonly audit: AuditService,
    private readonly applications: AgentApplicationService,
  ) {}

  /** How many applications are in each state, for the tabs. */
  async counts(country: string) {
    await requireCountry(this.db, country);
    const rows = await this.db
      .select({ status: agentApplications.status, count: sql<number>`count(*)::int` })
      .from(agentApplications)
      .where(eq(agentApplications.countryCode, country))
      .groupBy(agentApplications.status);
    return Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.count ?? 0]));
  }

  /**
   * Applications in one state. Those waiting for someone (in review, or being checked) come oldest first, so
   * the longest wait is seen first; the rest newest first.
   */
  async list(query: { country: string; status: ApplicationStatus; q?: string; before?: string; limit: number }) {
    await requireCountry(this.db, query.country);
    const cursor = parseCursor(query.before);
    const oldestFirst = query.status === 'review' || query.status === 'checking';
    const rows = await this.db
      .select({
        id: agentApplications.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        legalName: agentApplications.legalName,
        stateName: states.name,
        area: agentApplications.area,
        status: agentApplications.status,
        checks: agentApplications.checks,
        submittedAt: agentApplications.submittedAt,
        decidedAt: agentApplications.decidedAt,
        decisionNote: agentApplications.decisionNote,
        createdAt: agentApplications.createdAt,
        cursorAt: exactTime(since),
      })
      .from(agentApplications)
      .innerJoin(users, eq(users.id, agentApplications.userId))
      .leftJoin(
        states,
        and(eq(states.countryCode, agentApplications.countryCode), eq(states.code, agentApplications.stateCode)),
      )
      .where(
        and(
          eq(agentApplications.countryCode, query.country),
          eq(agentApplications.status, query.status),
          query.q ? this.search(query.q) : undefined,
          cursor
            ? oldestFirst
              ? sql`(${since}, ${agentApplications.userId}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : sql`(${since}, ${agentApplications.userId}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(
        oldestFirst
          ? sql`${since} asc, ${agentApplications.userId} asc`
          : sql`${since} desc, ${agentApplications.userId} desc`,
      )
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      applications: page.map(({ cursorAt: _, checks, ...r }) => ({
        ...r,
        /** The checks that didn't pass, which are why it is waiting. */
        flagged: labelled(checks.filter((c) => c.outcome !== 'passed')),
      })),
      next: rows.length > query.limit && last ? cursorOf(last) : null,
    };
  }

  private search(text: string): SQL | undefined {
    const like = containing(text);
    const phone = phoneDigits(text);
    const id = idPrefix(text);
    return or(
      ilike(sql`coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')`, like),
      ilike(agentApplications.legalName, like),
      id ? ilike(sql`${users.id}::text`, id) : undefined,
      phone ? ilike(users.phone, `%${phone}%`) : undefined,
    );
  }

  /** One agent's application, for their page: results only. */
  async detail(userId: string) {
    const [row] = await this.db
      .select({
        status: agentApplications.status,
        stateName: states.name,
        area: agentApplications.area,
        legalName: agentApplications.legalName,
        dateOfBirth: agentApplications.dateOfBirth,
        identityOutcome: agentApplications.identityOutcome,
        identityCheckedAt: agentApplications.identityCheckedAt,
        addressOutcome: agentApplications.addressOutcome,
        address: agentApplications.address,
        emergencyName: agentApplications.emergencyName,
        emergencyPhone: agentApplications.emergencyPhone,
        emergencyRelationship: agentApplications.emergencyRelationship,
        termsAcceptedAt: agentApplications.termsAcceptedAt,
        checks: agentApplications.checks,
        submittedAt: agentApplications.submittedAt,
        decidedAt: agentApplications.decidedAt,
        decidedBy: admins.name,
        decisionNote: agentApplications.decisionNote,
      })
      .from(agentApplications)
      .leftJoin(admins, eq(admins.id, agentApplications.decidedBy))
      .leftJoin(
        states,
        and(eq(states.countryCode, agentApplications.countryCode), eq(states.code, agentApplications.stateCode)),
      )
      .where(eq(agentApplications.userId, userId));
    if (!row) return null;
    const { emergencyName, emergencyPhone, emergencyRelationship, checks, ...rest } = row;
    return {
      ...rest,
      checks: labelled(checks),
      emergency: emergencyName
        ? { name: emergencyName, phone: emergencyPhone, relationship: emergencyRelationship }
        : null,
    };
  }

  /**
   * Support's decision on an application: approve, decline or reopen, with a reason. The rules are the
   * application's own; this adds the audit entry and tells the agent.
   */
  async decide(
    admin: AdminContext,
    userId: string,
    input: { decision: 'approve' | 'reject' | 'reopen'; note: string },
  ) {
    const { before, after } = await this.db.transaction(async (tx) => {
      const result = await this.applications.decide(tx, { userId, adminId: admin.adminId, ...input });
      await this.audit.record(tx, admin, {
        action: `application.${input.decision}`,
        targetType: 'person',
        targetId: userId,
        countryCode: result.before.countryCode,
        data: {
          note: input.note,
          from: result.before.status,
          flagged: result.before.checks.filter((c) => c.outcome !== 'passed').map((c) => c.key),
        },
      });
      return result;
    });
    await this.push.notifyUser(userId, 'agent', {
      title:
        after.status === 'approved'
          ? "You're approved"
          : after.status === 'draft'
            ? 'You can send your application again'
            : 'About your application',
      body:
        after.status === 'approved'
          ? 'Go online to see errands near you.'
          : after.status === 'draft'
            ? 'Open Jiffo Agent to change it and send it again.'
            : "Open Jiffo Agent to see our team's decision.",
      data: { type: 'agent.application', status: after.status, from: before.status },
    });
    return { status: after.status, decidedAt: after.decidedAt };
  }
}
