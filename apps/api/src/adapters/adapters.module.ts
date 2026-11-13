import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { BuiltinChatAdapter } from '../chat/builtin-chat.adapter';
import { CHAT, type ChatAdapter } from './chat';
import {
  ConsoleMessagingAdapter,
  MemoryMessagingAdapter,
  MESSAGING,
  TermiiMessagingAdapter,
  type MessagingAdapter,
} from './messaging';
import { ConsolePushAdapter, FcmPushAdapter, MemoryPushAdapter, PUSH, type PushAdapter } from './push';
import { FakePaymentsAdapter, PAYMENTS, PaystackPaymentsAdapter, type PaymentsAdapter } from './payments';
import { FakeMapsAdapter, GoogleMapsAdapter, MAPS, type MapsAdapter } from './maps';
import { MemoryStorageAdapter, S3StorageAdapter, STORAGE, type StorageAdapter } from './storage';
import { FakeIdentityAdapter, IDENTITY, UnconfiguredIdentityAdapter, type IdentityAdapter } from './identity';
import { CALLS, FakeCallsAdapter, UnconfiguredCallsAdapter, type CallsAdapter } from './calls';

/**
 * Picks one implementation per port from the environment. Admin-selected providers (identity, payments)
 * build on the same ports later.
 */
@Global()
@Module({
  providers: [
    {
      provide: IDENTITY,
      inject: [APP_CONFIG],
      // The real provider's adapter comes with its keys and SDK before launch. The fake never runs in
      // production, where it would approve every agent.
      useFactory: (c: AppConfig): IdentityAdapter => {
        switch (c.IDENTITY_PROVIDER) {
          case 'fake':
            return c.NODE_ENV === 'production' ? new UnconfiguredIdentityAdapter() : new FakeIdentityAdapter();
          default:
            return new UnconfiguredIdentityAdapter();
        }
      },
    },
    {
      provide: CALLS,
      inject: [APP_CONFIG],
      // The fake never runs in production, where it would tell people a phone is ringing when none is.
      useFactory: (c: AppConfig): CallsAdapter =>
        c.CALLS_PROVIDER === 'fake' && c.NODE_ENV !== 'production'
          ? new FakeCallsAdapter()
          : new UnconfiguredCallsAdapter(),
    },
    {
      provide: MESSAGING,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): MessagingAdapter => {
        switch (c.MESSAGING_PROVIDER) {
          case 'termii':
            return new TermiiMessagingAdapter(c.TERMII_API_KEY!, c.TERMII_SENDER_ID!, c.TERMII_BASE_URL);
          case 'memory':
            return new MemoryMessagingAdapter();
          default:
            return new ConsoleMessagingAdapter();
        }
      },
    },
    {
      provide: PUSH,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): PushAdapter => {
        switch (c.PUSH_PROVIDER) {
          case 'fcm':
            return new FcmPushAdapter(c.FCM_SERVICE_ACCOUNT_JSON!);
          case 'memory':
            return new MemoryPushAdapter();
          default:
            return new ConsolePushAdapter();
        }
      },
    },
    {
      provide: PAYMENTS,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): PaymentsAdapter =>
        c.PAYMENTS_PROVIDER === 'paystack'
          ? new PaystackPaymentsAdapter(c.PAYSTACK_SECRET_KEY!, c.PAYSTACK_BASE_URL)
          : new FakePaymentsAdapter(c.FAKE_PAYMENTS_SECRET, c.FAKE_PAYMENTS_AUTOPAY_SECONDS * 1000),
    },
    {
      provide: MAPS,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): MapsAdapter =>
        c.MAPS_PROVIDER === 'google' ? new GoogleMapsAdapter(c.GOOGLE_MAPS_API_KEY!) : new FakeMapsAdapter(),
    },
    {
      provide: STORAGE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): StorageAdapter =>
        c.STORAGE_PROVIDER === 's3'
          ? new S3StorageAdapter(c.S3_BUCKET!, c.S3_REGION, c.S3_ENDPOINT)
          : new MemoryStorageAdapter(c.PUBLIC_API_URL, c.JWT_SECRET),
    },
    {
      provide: CHAT,
      inject: [DB],
      useFactory: (db: Db): ChatAdapter => new BuiltinChatAdapter(db),
    },
  ],
  exports: [CALLS, IDENTITY, MESSAGING, PUSH, PAYMENTS, MAPS, STORAGE, CHAT],
})
export class AdaptersModule {}
