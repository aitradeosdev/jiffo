import type { MapsAdapter } from '../adapters/maps';
import type { MessagingAdapter } from '../adapters/messaging';
import type { PaymentsAdapter } from '../adapters/payments';
import type { PushAdapter } from '../adapters/push';
import type { StorageAdapter } from '../adapters/storage';

/** A service with no provider set up: no key in the panel and none in the environment. */
export class ProviderNotConfigured extends Error {
  constructor(readonly category: string) {
    super(`No ${category} provider is set up`);
  }
}

const refuse = (category: string) => () => Promise.reject(new ProviderNotConfigured(category));

/* In production, a category with no provider answers that it isn't set up yet; it never fakes success. */

export class NotConfiguredMessaging implements MessagingAdapter {
  readonly name = 'none';
  sendOtp = refuse('sms');
}

export class NotConfiguredPush implements PushAdapter {
  readonly name = 'none';
  send = refuse('push');
}

export class NotConfiguredMaps implements MapsAdapter {
  readonly name = 'none';
  autocomplete = refuse('maps');
  place = refuse('maps');
  route = refuse('maps');
}

export class NotConfiguredStorage implements StorageAdapter {
  readonly name = 'none';
  presignUpload = refuse('storage');
  presignDownload = refuse('storage');
  head = refuse('storage');
}

export class NotConfiguredPayments implements PaymentsAdapter {
  readonly name = 'none';
  createTransferDeposit = refuse('payments');
  verifyDeposit = refuse('payments');
  listBanks = refuse('payments');
  resolveAccount = refuse('payments');
  createRecipient = refuse('payments');
  transfer = refuse('payments');
  verifyTransfer = refuse('payments');
  balance = refuse('payments');
  parseWebhook() {
    return null;
  }
}
