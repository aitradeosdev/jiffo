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

/**
 * Picks one implementation per port from the environment. Admin-selected providers (identity, payments)
 * build on the same ports later.
 */
@Global()
@Module({
  providers: [
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
          : new FakePaymentsAdapter(c.FAKE_PAYMENTS_SECRET),
    },
    {
      provide: CHAT,
      inject: [DB],
      useFactory: (db: Db): ChatAdapter => new BuiltinChatAdapter(db),
    },
  ],
  exports: [MESSAGING, PUSH, PAYMENTS, CHAT],
})
export class AdaptersModule {}
