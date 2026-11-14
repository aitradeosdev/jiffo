import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { devices, sessions, type AppName } from '../db/schema';
import { PUSH, type PushAdapter, type PushNotification } from '../adapters/push';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PUSH) private readonly push: PushAdapter,
  ) {}

  async setToken(deviceId: string, token: string | null) {
    // A token belongs to one install: if it moved to another account on the same phone, take it off the old one.
    if (token) {
      await this.db
        .update(devices)
        .set({ pushToken: null, pushUpdatedAt: new Date() })
        .where(eq(devices.pushToken, token));
    }
    await this.db.update(devices).set({ pushToken: token, pushUpdatedAt: new Date() }).where(eq(devices.id, deviceId));
  }

  /**
   * Sends to these phones, signed in or not: for telling the phones a new sign-in has just signed out.
   * Push failures never fail the caller.
   */
  async notifyDevices(deviceIds: string[], notification: PushNotification) {
    if (!deviceIds.length) return;
    try {
      const rows = await this.db
        .selectDistinct({ token: devices.pushToken })
        .from(devices)
        .where(and(inArray(devices.id, deviceIds), isNotNull(devices.pushToken)));
      const tokens = rows.map((r) => r.token!);
      if (tokens.length) await this.push.send(tokens, notification);
    } catch (error) {
      this.logger.warn(`Push to ${deviceIds.length} phone(s) failed: ${(error as Error).message}`);
    }
  }

  /** Sends to every signed-in phone the person has for that app. Push failures never fail the caller. */
  async notifyUser(userId: string, app: AppName, notification: PushNotification) {
    try {
      const rows = await this.db
        .selectDistinct({ token: devices.pushToken })
        .from(devices)
        .innerJoin(sessions, eq(sessions.deviceId, devices.id))
        .where(
          and(
            eq(devices.userId, userId),
            eq(devices.app, app),
            isNotNull(devices.pushToken),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      const tokens = rows.map((r) => r.token!);
      if (tokens.length === 0) return;
      const { invalidTokens } = await this.push.send(tokens, notification);
      if (invalidTokens.length > 0) {
        await this.db
          .update(devices)
          .set({ pushToken: null, pushUpdatedAt: new Date() })
          .where(inArray(devices.pushToken, invalidTokens));
      }
    } catch (error) {
      this.logger.warn(`Push to ${userId} failed: ${(error as Error).message}`);
    }
  }
}
