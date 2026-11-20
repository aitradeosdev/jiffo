import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { canonicalJson } from '../common/canonical-json';
import { notFound } from '../common/errors';
import { DB, type Db, type Tx } from '../db/database.module';
import { keptKey } from '../files/uploads.service';
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

/** What made a pack: the event that put the errand into dispute, or staff taking another. */
export type EvidenceReason =
  'open_dispute' | 'pin_locked' | 'item_lock_timeout' | 'unreachable_timeout' | 'admin_intervene' | 'staff';
const DISPUTE_REASONS: ReadonlySet<string> = new Set([
  'open_dispute',
  'pin_locked',
  'item_lock_timeout',
  'unreachable_timeout',
  'admin_intervene',
]);

/** The errand events that are PIN entries, in the pack on their own as well as in the timeline. */
const PIN_EVENTS = new Set(['confirm_pin', 'pin_wrong', 'pin_locked']);
/** How many trail points the errand page draws; the pack's fingerprint covers them all. */
const TRAIL_SHOWN = 2_000;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Plain JSON, as it will be stored and read back: dates as ISO text, nothing undefined. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Disputes' evidence packs (docs/security-plan.md, E8): made as an errand goes into dispute, however that
 * happens, in the same transaction, so the pack is the errand exactly as it was then; and whenever staff
 * take another. A pack is a fixed copy: the database refuses any change to it, and its SHA-256 shows anyone
 * that what they hold is what was made. The GPS trail is fingerprinted, not copied: G4 keeps it only so
 * long, and the pack mustn't keep it longer.
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * The errand is going into dispute, in this transaction: its pack is made in it. A pack that can't be made
   * doesn't stop the dispute: it is rolled back on its own, and the team is alerted to take one by hand.
   */
  async onDispute(tx: Tx, errand: { id: string; countryCode: string }, event: string) {
    const reason = (DISPUTE_REASONS.has(event) ? event : 'open_dispute') as EvidenceReason;
    try {
      await tx.transaction((inner) => this.take(errand.id, reason, null, inner));
    } catch (error) {
      this.logger.error(`The evidence pack for ${errand.id} failed: ${(error as Error).message}`);
      await this.alerts
        .raise({
          countryCode: errand.countryCode,
          kind: 'evidence_failed',
          dedupeKey: errand.id,
          message: `The evidence pack for errand ${errand.id} couldn't be made as it went into dispute. Take one from the errand's page.`,
          data: { errandId: errand.id, event },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Makes a pack of what the errand holds now, reading and writing through `db`: the caller's transaction,
   * so everything in it is read as of one moment.
   */
  async take(errandId: string, reason: EvidenceReason, takenBy: string | null, db: Db | Tx) {
    const content = await this.assemble(errandId, db);
    const [made] = await db
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
  calls(errandId: string, db: Db | Tx = this.db) {
    return db
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
  trail(errandId: string, db: Db | Tx = this.db) {
    return db
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
  }

  /**
   * The trail for the errand's page: the latest couple of thousand points, oldest first, as the end of an
   * errand (the drop-off) is what a dispute is mostly about; and whether there are more.
   */
  async trailShown(errandId: string) {
    const latest = await this.db
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
      .orderBy(desc(errandTrail.at), desc(errandTrail.id))
      .limit(TRAIL_SHOWN + 1);
    return { points: latest.slice(0, TRAIL_SHOWN).reverse(), more: latest.length > TRAIL_SHOWN };
  }

  private async assemble(errandId: string, db: Db | Tx) {
    const [errand] = await db.select().from(errands).where(eq(errands.id, errandId));
    if (!errand) throw notFound('errand_not_found', 'Errand not found');
    const [stops, events, convos, files, calls, trail, flags, money] = await Promise.all([
      db
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
      db
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
      db
        .select({ id: conversations.id, agentId: conversations.agentId })
        .from(conversations)
        .where(eq(conversations.errandId, errandId)),
      db
        .select({
          id: uploads.id,
          purpose: uploads.purpose,
          ownerId: uploads.ownerId,
          contentType: uploads.contentType,
          key: uploads.key,
          // The server's copy (C1): its fingerprint shows a photo shown later is the one that was sent.
          checkedAt: uploads.checkedAt,
          sha256: uploads.sha256,
          size: uploads.size,
          createdAt: uploads.createdAt,
        })
        .from(uploads)
        .where(eq(uploads.errandId, errandId))
        .orderBy(asc(uploads.createdAt)),
      this.calls(errandId, db),
      this.trail(errandId, db),
      db
        .select({ id: riskFlags.id, kind: riskFlags.kind, status: riskFlags.status, createdAt: riskFlags.createdAt })
        .from(riskFlagErrands)
        .innerJoin(riskFlags, eq(riskFlags.id, riskFlagErrands.flagId))
        .where(eq(riskFlagErrands.errandId, errandId))
        .orderBy(asc(riskFlags.createdAt)),
      db
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
      ? await db
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
      // storedKey is the server's copy, which the fingerprint is of; key is what the app sent (C1).
      uploads: files.map((f) => ({ ...f, storedKey: keptKey(f.key) })),
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
      // As the errand's page shows it: an account here is owed by the platform, so a credit is money into it.
      money: money.map(({ amount, ...m }) => ({ ...m, amountKobo: -Number(amount) })),
    });
  }
}
