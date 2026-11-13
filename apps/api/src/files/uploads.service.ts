import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { errands, uploads, type UploadPurpose } from '../db/schema';
import { STORAGE, type StorageAdapter } from '../adapters/storage';
import type { AuthContext } from '../auth/auth.types';
import { forbidden, notFound, unprocessable } from '../common/errors';

const UPLOAD_TTL_SECONDS = 10 * 60;
const DOWNLOAD_TTL_SECONDS = 15 * 60;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** Who may upload what: the agent sends receipts, item and drop-off photos; both sides can send chat photos. */
const PURPOSES_BY_ROLE: Record<'customer' | 'agent', UploadPurpose[]> = {
  customer: ['chat_photo'],
  agent: ['receipt', 'item_photo', 'dropoff_photo', 'chat_photo'],
};

@Injectable()
export class UploadsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  private async roleOn(errandId: string, auth: AuthContext) {
    const [errand] = await this.db
      .select({ customerId: errands.customerId, agentId: errands.agentId })
      .from(errands)
      .where(eq(errands.id, errandId));
    if (auth.app === 'customer' && errand?.customerId === auth.userId) return 'customer' as const;
    if (auth.app === 'agent' && errand?.agentId === auth.userId) return 'agent' as const;
    throw notFound('errand_not_found', 'Errand not found');
  }

  /** A signed link to upload one photo for an errand, straight to storage. */
  async create(auth: AuthContext, input: { errandId: string; purpose: UploadPurpose; contentType: string }) {
    const role = await this.roleOn(input.errandId, auth);
    if (!PURPOSES_BY_ROLE[role].includes(input.purpose))
      throw forbidden('upload_not_allowed', 'You can’t add this kind of photo');
    const ext = TYPES[input.contentType];
    if (!ext) throw unprocessable('unsupported_file', 'Send a JPEG, PNG, WebP or HEIC photo');
    const key = `errands/${input.errandId}/${input.purpose}/${randomUUID()}.${ext}`;
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
      ttlSeconds: UPLOAD_TTL_SECONDS,
    });
    return { key, upload, maxBytes: MAX_BYTES };
  }

  /**
   * Checks that every key is a photo this person uploaded for this errand, for one of the allowed
   * purposes, and that the file actually arrived (and isn't too big). Run before the errand transaction:
   * it may call the store.
   */
  async assertUploaded(keys: string[], input: { ownerId: string; errandId: string; purposes: UploadPurpose[] }) {
    if (keys.length === 0) return;
    const rows = await this.db
      .select({ key: uploads.key })
      .from(uploads)
      .where(
        and(
          inArray(uploads.key, keys),
          eq(uploads.ownerId, input.ownerId),
          eq(uploads.errandId, input.errandId),
          inArray(uploads.purpose, input.purposes),
        ),
      );
    const known = new Set(rows.map((r) => r.key));
    for (const key of keys) {
      const stored = known.has(key) ? await this.storage.head(key) : null;
      if (!stored)
        throw unprocessable('photo_not_uploaded', 'A photo didn’t finish uploading. Take it again.', { key });
      if (stored.size > MAX_BYTES) throw unprocessable('photo_too_large', 'That photo is too large', { key });
    }
  }

  /** A short-lived link to view a photo. Callers check the viewer may see the errand first. */
  url(key: string) {
    return this.storage.presignDownload(key, DOWNLOAD_TTL_SECONDS);
  }
}
