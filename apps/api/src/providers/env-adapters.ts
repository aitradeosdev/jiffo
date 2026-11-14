import { CallsAdapter, FakeCallsAdapter, UnconfiguredCallsAdapter } from '../adapters/calls';
import { FakeIdentityAdapter, IdentityAdapter, UnconfiguredIdentityAdapter } from '../adapters/identity';
import { ConsoleEmailAdapter, MemoryEmailAdapter, type EmailAdapter } from '../adapters/email';
import { FakeMapsAdapter, GoogleMapsAdapter, type MapsAdapter } from '../adapters/maps';
import {
  ConsoleMessagingAdapter,
  MemoryMessagingAdapter,
  TermiiMessagingAdapter,
  type MessagingAdapter,
} from '../adapters/messaging';
import { FakePaymentsAdapter, PaystackPaymentsAdapter, type PaymentsAdapter } from '../adapters/payments';
import { isPaystackHost, isPaystackTestKey, isTermiiHost, moneyKey, providerUrl, storageEndpoint } from './builders';
import { ConsolePushAdapter, FcmPushAdapter, MemoryPushAdapter, type PushAdapter } from '../adapters/push';
import { MemoryStorageAdapter, S3StorageAdapter, type StorageAdapter } from '../adapters/storage';
import type { AppConfig } from '../config/app-config';
import {
  NotConfiguredEmail,
  NotConfiguredMaps,
  NotConfiguredMessaging,
  NotConfiguredPayments,
  NotConfiguredPush,
  NotConfiguredStorage,
} from './not-configured';

export interface Adapters {
  payments: PaymentsAdapter;
  sms: MessagingAdapter;
  identity: IdentityAdapter;
  calls: CallsAdapter;
  push: PushAdapter;
  maps: MapsAdapter;
  storage: StorageAdapter;
  email: EmailAdapter;
}

export const ENV_ADAPTERS = Symbol('ENV_ADAPTERS');

/**
 * What the environment chooses, used for a category while admin hasn't switched a provider on in the panel.
 * In development and tests these are the stand-ins (console SMS, the fake bank, and so on). In production
 * a stand-in is never used: a category with nothing set answers that it isn't set up yet.
 */
export function envAdapters(c: AppConfig): Adapters {
  const live = c.NODE_ENV === 'production';
  return {
    payments:
      c.PAYMENTS_PROVIDER === 'paystack'
        ? // The same checks as keys entered in the panel (see builders.ts).
          new PaystackPaymentsAdapter(
            moneyKey(c.PAYSTACK_SECRET_KEY!, { production: live }, isPaystackTestKey, 'Paystack'),
            providerUrl(c.PAYSTACK_BASE_URL, isPaystackHost, 'Paystack'),
          )
        : live
          ? new NotConfiguredPayments()
          : new FakePaymentsAdapter(c.FAKE_PAYMENTS_SECRET, c.FAKE_PAYMENTS_AUTOPAY_SECONDS * 1000),
    sms:
      c.MESSAGING_PROVIDER === 'termii'
        ? new TermiiMessagingAdapter(
            c.TERMII_API_KEY!,
            c.TERMII_SENDER_ID!,
            providerUrl(c.TERMII_BASE_URL, isTermiiHost, 'Termii') ?? 'https://api.ng.termii.com',
          )
        : live
          ? new NotConfiguredMessaging()
          : c.MESSAGING_PROVIDER === 'memory'
            ? new MemoryMessagingAdapter()
            : new ConsoleMessagingAdapter(),
    // The fakes would approve every agent and pretend phones ring: never in production.
    identity: c.IDENTITY_PROVIDER === 'fake' && !live ? new FakeIdentityAdapter() : new UnconfiguredIdentityAdapter(),
    calls: c.CALLS_PROVIDER === 'fake' && !live ? new FakeCallsAdapter() : new UnconfiguredCallsAdapter(),
    push:
      c.PUSH_PROVIDER === 'fcm'
        ? new FcmPushAdapter(c.FCM_SERVICE_ACCOUNT_JSON!)
        : live
          ? new NotConfiguredPush()
          : c.PUSH_PROVIDER === 'memory'
            ? new MemoryPushAdapter()
            : new ConsolePushAdapter(),
    maps:
      c.MAPS_PROVIDER === 'google'
        ? new GoogleMapsAdapter(c.GOOGLE_MAPS_API_KEY!)
        : live
          ? new NotConfiguredMaps()
          : new FakeMapsAdapter(),
    storage:
      c.STORAGE_PROVIDER === 's3'
        ? new S3StorageAdapter(c.S3_BUCKET!, c.S3_REGION, storageEndpoint(c.S3_ENDPOINT, { production: live }))
        : live
          ? new NotConfiguredStorage()
          : new MemoryStorageAdapter(c.PUBLIC_API_URL, c.JWT_SECRET),
    // Email providers are set only in the panel; the environment picks the development stand-in, or none.
    email:
      live || c.EMAIL_PROVIDER === 'none'
        ? new NotConfiguredEmail()
        : c.EMAIL_PROVIDER === 'memory'
          ? new MemoryEmailAdapter()
          : new ConsoleEmailAdapter(),
  };
}
