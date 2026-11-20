import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DEFAULT_SECURITY_SETTINGS, TERMINAL_STATES } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { errands, uploads, type UploadPurpose } from '../db/schema';
import { STORAGE, type StorageAdapter } from '../adapters/storage';
import type { AuthContext } from '../auth/auth.types';
import { conflict, forbidden, notFound, tooMany, unprocessable } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { participantRole } from '../errands/access';
import { rewritePhoto, UnreadablePhoto } from './photo-check';

const UPLOAD_TTL_SECONDS = 10 * 60;
const MAX_BYTES = 10 * 1024 * 1024;
/** Enough for any real errand; stops one person filling storage through one errand. */
const MAX_UPLOADS_PER_ERRAND = 50;
/**
 * The photo types the apps may say they send (docs/security-plan.md, C1). What a file really is comes from
 * its bytes, when it is used: these only name the upload.
 */
const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

/** Where the apps' uploads land. Nobody is shown anything here, and the server deletes each once it has its copy. */
const INCOMING = 'incoming/';
/**
 * Where the server keeps its own copy of an upload, re-encoded: the only one anybody is shown. A photo
 * uploaded before these checks (not under incoming/) keeps its key, and its copy is written over it.
 */
export const keptKey = (key: string) =>
  key.startsWith(INCOMING) ? `errands/${key.slice(INCOMING.length).replace(/\.[a-z]+$/, '')}.jpg` : key;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const notUploaded = (key: string) =>
  unprocessable('photo_not_uploaded', 'A photo didn’t finish uploading. Take it again.', { key });

/** Who may upload what: the agent sends receipts, item and drop-off photos; both sides can send chat photos. */
const PURPOSES_BY_ROLE: Record<'customer' | 'agent', UploadPurpose[]> = {
  customer: ['chat_photo'],
  agent: ['receipt', 'item_photo', 'dropoff_photo', 'chat_photo'],
};

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
    private readonly countries: CountriesService,
  ) {}

  /** A signed link to upload one photo for an errand, straight to storage. */
  async create(
    auth: AuthContext,
    input: { errandId: string; purpose: UploadPurpose; contentType: string; size: number },
  ) {
    const [errand] = await this.db
      .select({ customerId: errands.customerId, agentId: errands.agentId, status: errands.status })
      .from(errands)
      .where(eq(errands.id, input.errandId));
    const role = participantRole(errand, auth);
    if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
    // Photos belong to an errand in progress: none before an agent accepts, none once it has ended.
    if (errand.status === 'requested' || TERMINAL_STATES.has(errand.status)) {
      throw conflict('uploads_closed', 'Photos can only be added while the errand is in progress');
    }
    if (input.size > MAX_BYTES)
      throw unprocessable('photo_too_large', 'That photo is too large', { maxBytes: MAX_BYTES });
    const [made] = await this.db
      .select({ n: count() })
      .from(uploads)
      .where(and(eq(uploads.errandId, input.errandId), eq(uploads.ownerId, auth.userId)));
    if ((made?.n ?? 0) >= MAX_UPLOADS_PER_ERRAND) throw tooMany('too_many_uploads', 'Too many photos for this errand');
    if (!PURPOSES_BY_ROLE[role].includes(input.purpose))
      throw forbidden('upload_not_allowed', 'You can’t add this kind of photo');
    const ext = TYPES[input.contentType];
    if (!ext) throw unprocessable('unsupported_file', 'Send a JPEG, PNG or HEIC photo');
    const key = `${INCOMING}${input.errandId}/${input.purpose}/${randomUUID()}.${ext}`;
    await this.db.insert(uploads).values({
      key,
      ownerId: auth.userId,
      errandId: input.errandId,
      purpose: input.purpose,
      contentType: input.contentType,
    });
    const upload = await this.storage.presignUpload({
      key,
      contentType: input.contentType,
      size: input.size,
      ttlSeconds: UPLOAD_TTL_SECONDS,
    });
    return { key, upload, maxBytes: MAX_BYTES };
  }

  /**
   * Checks that every key is a photo this person uploaded for this errand, for one of the allowed
   * purposes, and that it is a photo: the first time a key is used, the server opens the file and keeps its
   * own copy, re-encoded (C1). Run before the errand transaction: it calls the store.
   */
  async assertUploaded(keys: string[], input: { ownerId: string; errandId: string; purposes: UploadPurpose[] }) {
    if (keys.length === 0) return;
    const rows = await this.db
      .select({ key: uploads.key, checkedAt: uploads.checkedAt })
      .from(uploads)
      .where(
        and(
          inArray(uploads.key, keys),
          eq(uploads.ownerId, input.ownerId),
          eq(uploads.errandId, input.errandId),
          inArray(uploads.purpose, input.purposes),
        ),
      );
    const known = new Map(rows.map((r) => [r.key, r]));
    await Promise.all(
      [...new Set(keys)].map(async (key) => {
        const row = known.get(key);
        if (!row) throw notUploaded(key);
        if (!row.checkedAt) return this.check(key);
        // Checked before (sent again after a dropped connection, say): the copy must still be there.
        if (!(await this.storage.head(keptKey(key)))) throw notUploaded(key);
      }),
    );
  }

  /**
   * Opens an upload and keeps the server's own copy: a plain JPEG with only the pixels, so no location,
   * camera details or anything hidden in the file, and nothing that isn't really a photo. Then the
   * original goes.
   */
  private async check(key: string) {
    const original = await this.storage.get(key, MAX_BYTES);
    if (original === 'too_large') throw unprocessable('photo_too_large', 'That photo is too large', { key });
    if (!original) {
      // Another request may just have kept its copy and deleted the original.
      const [row] = await this.db.select({ checkedAt: uploads.checkedAt }).from(uploads).where(eq(uploads.key, key));
      if (row?.checkedAt) return;
      throw notUploaded(key);
    }
    let photo: Buffer;
    try {
      photo = await rewritePhoto(original);
    } catch (error) {
      if (!(error instanceof UnreadablePhoto)) throw error;
      throw unprocessable('photo_unreadable', 'That photo couldn’t be read. Take it again.', { key });
    }
    const kept = keptKey(key);
    await this.storage.put(kept, photo, 'image/jpeg');
    await this.db
      .update(uploads)
      .set({ checkedAt: new Date(), contentType: 'image/jpeg', sha256: sha256(photo), size: photo.length })
      .where(eq(uploads.key, key));
    // A photo uploaded before these checks has its copy written where it was: that is the only file left.
    if (kept === key) return;
    await this.storage.delete(key).catch((error: Error) => {
      // The copy is kept and is all anybody sees; the store's own expiry for incoming/ removes this later.
      this.logger.warn(`The original of ${key} wasn't deleted: ${error.message}`);
    });
  }

  /**
   * Makes short-lived links to see photos of an errand in this country: they last the minutes Settings,
   * Security give (C1, X10). Callers check the viewer may see the errand first.
   */
  async links(countryCode: string) {
    const current = await this.countries.currentSettingsIfAny(countryCode);
    const minutes = current?.settings.security.signedLinkMinutes ?? DEFAULT_SECURITY_SETTINGS.signedLinkMinutes;
    return (key: string) => this.storage.presignDownload(keptKey(key), minutes * 60);
  }
}
