import { CallsAdapter, FakeCallsAdapter, UnconfiguredCallsAdapter } from '../adapters/calls';
import { FakeIdentityAdapter, IdentityAdapter, UnconfiguredIdentityAdapter } from '../adapters/identity';
import { FakeMapsAdapter, GoogleMapsAdapter, type MapsAdapter } from '../adapters/maps';
import {
  ConsoleMessagingAdapter,
  MemoryMessagingAdapter,
  TermiiMessagingAdapter,
  type MessagingAdapter,
} from '../adapters/messaging';
import { FakePaymentsAdapter, PaystackPaymentsAdapter, type PaymentsAdapter } from '../adapters/payments';
import { ConsolePushAdapter, FcmPushAdapter, MemoryPushAdapter, type PushAdapter } from '../adapters/push';
import { MemoryStorageAdapter, S3StorageAdapter, type StorageAdapter } from '../adapters/storage';
import type { AppConfig } from '../config/app-config';
import {
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
        ? new PaystackPaymentsAdapter(c.PAYSTACK_SECRET_KEY!, c.PAYSTACK_BASE_URL)
        : live
          ? new NotConfiguredPayments()
          : new FakePaymentsAdapter(c.FAKE_PAYMENTS_SECRET, c.FAKE_PAYMENTS_AUTOPAY_SECONDS * 1000),
    sms:
      c.MESSAGING_PROVIDER === 'termii'
        ? new TermiiMessagingAdapter(c.TERMII_API_KEY!, c.TERMII_SENDER_ID!, c.TERMII_BASE_URL)
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
        ? new S3StorageAdapter(c.S3_BUCKET!, c.S3_REGION, c.S3_ENDPOINT)
        : live
          ? new NotConfiguredStorage()
          : new MemoryStorageAdapter(c.PUBLIC_API_URL, c.JWT_SECRET),
  };
}
