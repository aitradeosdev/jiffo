import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { canonicalJson } from '../common/canonical-json';
import { notFound } from '../common/errors';
import { DB, type Db, type Tx } from '../db/database.module';
import {
  admins,
  conversations,
  disputeEvidence,
  errandCalls,
  errandEvents,
  errandStops,
  errandTrail,
  errands,
  journalEntries,
  ledgerAccounts,
  messages,
  postings,
  riskFlagErrands,
  riskFlags,
  uploads,
} from '../db/schema';

export type EvidenceReason = 'open_dispute' | 'pin_locked' | 'staff';

/** The errand events that are PIN entries, in the pack on their own as well as in the timeline. */
const PIN_EVENTS = new Set(['confirm_pin', 'pin_wrong', 'pin_locked']);
/** How many trail points the errand page draws; the pack's fingerprint covers them all. */
const TRAIL_SHOWN = 2_000;
const SHUTDOWN_WAIT_MS = 5_000;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Plain JSON, as it will be stored and read back: dates as ISO text, nothing undefined. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Disputes' evidence packs (docs/security-plan.md, E8): assembled when an errand goes into dispute, whether
 * a side opened it or too many wrong PINs froze it, and whenever staff take another. A pack is a fixed copy:
 * the database refuses any change to it, and its SHA-256 shows anyone that what they hold is what was made.
 * The GPS trail is fingerprinted, not copied: G4 keeps it only so long, and the pack mustn't keep it longer.
 */
@Injectable()
export class EvidenceService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly running = new Set<Promise<unknown>>();

  constructor(@Inject(DB) private readonly db: Db) {}

  /** An errand went into dispute: its pack is made beside the change, never failing it. */
  disputeOpened(errandId: string, event: string) {
    const reason: EvidenceReason = event === 'pin_locked' ? 'pin_locked' : 'open_dispute';
    const run: Promise<unknown> = this.take(errandId, reason)
      .catch((error: Error) => this.logger.error(`The evidence pack for ${errandId} failed: ${error.message}`))
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /** Waits for packs being made: for tests, and before the database closes. */
  async settled() {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  async beforeApplicationShutdown() {
    await Promise.race([this.settled(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
  }

  /** Makes a pack of what the errand holds now: in the caller's transaction, when given one. */
  async take(errandId: string, reason: EvidenceReason, takenBy: string | null = null, tx: Db | Tx = this.db) {
    const content = await this.assemble(errandId);
    const [made] = await tx
      .insert(disputeEvidence)
      .values({ errandId, reason, takenBy, content, sha256: sha256(canonicalJson(content)) })
      .returning({
        id: disputeEvidence.id,
        reason: disputeEvidence.reason,
        sha256: disputeEvidence.sha256,
        createdAt: disputeEvidence.createdAt,
      });
    return made!;
  }

  /** The errand's packs, newest first, without their content. */
  list(errandId: string) {
    return this.db
      .select({
        id: disputeEvidence.id,
        reason: disputeEvidence.reason,
        sha256: disputeEvidence.sha256,
        createdAt: disputeEvidence.createdAt,
        takenBy: admins.name,
      })
      .from(disputeEvidence)
      .leftJoin(admins, eq(admins.id, disputeEvidence.takenBy))
      .where(eq(disputeEvidence.errandId, errandId))
      .orderBy(desc(disputeEvidence.createdAt), desc(disputeEvidence.id));
  }

  /** One pack in full, if it is this errand's. */
  async get(errandId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(disputeEvidence)
      .where(and(eq(disputeEvidence.id, id), eq(disputeEvidence.errandId, errandId)));
    if (!row) throw notFound('evidence_not_found', 'Evidence pack not found');
    return row;
  }

  /** Who called whom on the errand, through Jiffo, and when. Nothing of the call itself is kept. */
  calls(errandId: string) {
    return this.db
      .select({
        id: errandCalls.id,
        callerRole: errandCalls.callerRole,
        callerId: errandCalls.callerId,
        calleeId: errandCalls.calleeId,
        provider: errandCalls.provider,
        createdAt: errandCalls.createdAt,
      })
      .from(errandCalls)
      .where(eq(errandCalls.errandId, errandId))
      .orderBy(asc(errandCalls.createdAt));
  }

  /** The errand's GPS trail as kept now, oldest first, every agent's that was out on it. */
  trail(errandId: string, limit?: number) {
    const query = this.db
      .select({
        agentId: errandTrail.agentId,
        lat: errandTrail.lat,
        lng: errandTrail.lng,
        mocked: errandTrail.mocked,
        accuracy: errandTrail.accuracy,
        fixedAt: errandTrail.fixedAt,
        at: errandTrail.at,
      })
      .from(errandTrail)
      .where(eq(errandTrail.errandId, errandId))
      .orderBy(asc(errandTrail.at), asc(errandTrail.id));
    return limit ? query.limit(limit) : query;
  }

  /** The trail for the errand's page: up to a couple of thousand points, and how many there are. */
  async trailShown(errandId: string) {
    const points = await this.trail(errandId, TRAIL_SHOWN + 1);
    return { points: points.slice(0, TRAIL_SHOWN), more: points.length > TRAIL_SHOWN };
  }

  private async assemble(errandId: string) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    if (!errand) throw notFound('errand_not_found', 'Errand not found');
    const [stops, events, convos, files, calls, trail, flags, money] = await Promise.all([
      this.db
        .select({
          seq: errandStops.seq,
          kind: errandStops.kind,
          label: errandStops.label,
          address: errandStops.address,
          lat: errandStops.lat,
          lng: errandStops.lng,
        })
        .from(errandStops)
        .where(eq(errandStops.errandId, errandId))
        .orderBy(asc(errandStops.seq)),
      this.db
        .select({
          id: errandEvents.id,
          event: errandEvents.event,
          fromStatus: errandEvents.fromStatus,
          toStatus: errandEvents.toStatus,
          actorRole: errandEvents.actorRole,
          actorId: errandEvents.actorId,
          data: errandEvents.data,
          createdAt: errandEvents.createdAt,
        })
        .from(errandEvents)
        .where(eq(errandEvents.errandId, errandId))
        .orderBy(asc(errandEvents.id)),
      this.db
        .select({ id: conversations.id, agentId: conversations.agentId })
        .from(conversations)
        .where(eq(conversations.errandId, errandId)),
      this.db
        .select({
          id: uploads.id,
          purpose: uploads.purpose,
          ownerId: uploads.ownerId,
          contentType: uploads.contentType,
          key: uploads.key,
          createdAt: uploads.createdAt,
        })
        .from(uploads)
        .where(eq(uploads.errandId, errandId))
        .orderBy(asc(uploads.createdAt)),
      this.calls(errandId),
      this.trail(errandId),
      this.db
        .select({ id: riskFlags.id, kind: riskFlags.kind, status: riskFlags.status, createdAt: riskFlags.createdAt })
        .from(riskFlagErrands)
        .innerJoin(riskFlags, eq(riskFlags.id, riskFlagErrands.flagId))
        .where(eq(riskFlagErrands.errandId, errandId))
        .orderBy(asc(riskFlags.createdAt)),
      this.db
        .select({
          journalId: journalEntries.id,
          kind: journalEntries.kind,
          createdAt: journalEntries.createdAt,
          account: ledgerAccounts.type,
          ownerId: ledgerAccounts.ownerId,
          amount: postings.amount,
        })
        .from(journalEntries)
        .innerJoin(postings, eq(postings.journalId, journalEntries.id))
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
        .where(eq(journalEntries.errandId, errandId))
        .orderBy(asc(journalEntries.createdAt), asc(postings.id)),
    ]);
    const chat = convos.length
      ? await this.db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderRole: messages.senderRole,
            senderId: messages.senderId,
            kind: messages.kind,
            body: messages.body,
            data: messages.data,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(
            inArray(
              messages.conversationId,
              convos.map((c) => c.id),
            ),
          )
          .orderBy(asc(messages.id))
      : [];
    const { pinCipher: _pin, pinHmac: _pinCheck, ...fields } = errand;
    const points = plain(trail);
    return plain({
      version: 1,
      takenAt: new Date(),
      errand: fields,
      stops,
      events,
      pinEntries: events.filter((e) => PIN_EVENTS.has(e.event)),
      conversations: convos,
      messages: chat,
      uploads: files,
      calls,
      trail: {
        points: points.length,
        mocked: points.filter((p) => p.mocked).length,
        first: points[0]?.at ?? null,
        last: points.at(-1)?.at ?? null,
        // Of the points as kept now: the errand's page shows them while G4 keeps them.
        sha256: points.length ? sha256(canonicalJson(points)) : null,
      },
      flags,
      money: money.map((m) => ({ ...m, amount: Number(m.amount) })),
    });
  }
}
