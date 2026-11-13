import type { ProviderCategory } from '@jiffo/shared';
import { GoogleMapsAdapter } from '../adapters/maps';
import { AfricasTalkingMessagingAdapter, TermiiMessagingAdapter } from '../adapters/messaging';
import { AfricasTalkingCallsAdapter, TwilioCallsAdapter } from '../adapters/calls';
import { FlutterwavePaymentsAdapter, PaystackPaymentsAdapter } from '../adapters/payments';
import { FcmPushAdapter } from '../adapters/push';
import { S3StorageAdapter } from '../adapters/storage';
import type { Adapters } from './env-adapters';

type Values = Record<string, string>;
const optional = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/**
 * How each provider's adapter is made from the fields admin saved (secrets already decrypted). Every
 * provider in the shared catalogue has a builder here; the test in providers.e2e checks they match.
 */
export const BUILDERS: { [C in ProviderCategory]: Record<string, (v: Values) => Adapters[C]> } = {
  payments: {
    flutterwave: (v) => new FlutterwavePaymentsAdapter(v.secretKey!, v.secretHash!, v.businessName!),
    paystack: (v) => new PaystackPaymentsAdapter(v.secretKey!, optional(v.baseUrl)),
  },
  sms: {
    africastalking: (v) => new AfricasTalkingMessagingAdapter(v.username!, v.apiKey!, optional(v.senderId)),
    termii: (v) =>
      new TermiiMessagingAdapter(v.apiKey!, v.senderId!, optional(v.baseUrl) ?? 'https://api.ng.termii.com'),
  },
  identity: {},
  calls: {
    africastalking: (v) => new AfricasTalkingCallsAdapter(v.username!, v.apiKey!, v.phoneNumber!),
    twilio: (v) => new TwilioCallsAdapter(v.accountSid!, v.authToken!, v.fromNumber!),
  },
  push: {
    fcm: (v) => new FcmPushAdapter(v.serviceAccountJson!),
  },
  maps: {
    google: (v) => new GoogleMapsAdapter(v.apiKey!),
  },
  storage: {
    s3: (v) =>
      new S3StorageAdapter(v.bucket!, v.region!, optional(v.endpoint), {
        accessKeyId: v.accessKeyId!,
        secretAccessKey: v.secretAccessKey!,
      }),
  },
};

/**
 * What the panel's Test button does for each kind of adapter: something read-only that proves the keys
 * work, with a short answer. An adapter can do its own check; payments ask for the balance.
 */
export async function checkAdapter(category: ProviderCategory, adapter: unknown): Promise<string> {
  const own = (adapter as { check?: () => Promise<string> }).check;
  if (typeof own === 'function') return own.call(adapter);
  if (category === 'payments') {
    const kobo = await (adapter as Adapters['payments']).balance('NGN');
    return `Connected. Balance: ₦${(kobo / 100).toLocaleString('en-NG')}`;
  }
  throw new Error('This provider has no test yet');
}
