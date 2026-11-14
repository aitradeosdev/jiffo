import type { ProviderCategory } from '@jiffo/shared';
import { GoogleMapsAdapter } from '../adapters/maps';
import { AfricasTalkingMessagingAdapter, TermiiMessagingAdapter } from '../adapters/messaging';
import { AfricasTalkingCallsAdapter, TwilioCallsAdapter } from '../adapters/calls';
import { FlutterwavePaymentsAdapter, PaystackPaymentsAdapter } from '../adapters/payments';
import { FcmPushAdapter } from '../adapters/push';
import { S3StorageAdapter } from '../adapters/storage';
import type { Adapters } from './env-adapters';
import {
  DojahIdentityAdapter,
  SmileIdIdentityAdapter,
  YouverifyIdentityAdapter,
  type ProviderContext,
} from '../adapters/identity-providers';

type Values = Record<string, string>;
/**
 * Whether a provider runs in its sandbox. Refused in production (docs/security-plan.md, finding 10): a
 * sandbox passes anyone, so one admin switching to it would let unverified people through.
 */
const sandboxMode = (v: string | undefined, ctx: ProviderContext) => {
  const sandbox = (v ?? '').trim().toLowerCase() === 'sandbox';
  if (sandbox && ctx.production)
    throw new Error('Sandbox mode is for testing. In production, use live mode and live keys.');
  return sandbox;
};
const optional = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/**
 * A provider address typed in the panel, only if it is https on one of the provider's own hosts
 * (docs/security-plan.md, finding 18): a stolen owner session can't point a provider, and its keys, elsewhere.
 */
export const providerUrl = (v: string | undefined, hosts: (host: string) => boolean, name: string) => {
  const text = optional(v);
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`The ${name} address isn't a web address`);
  }
  if (url.protocol !== 'https:' || !hosts(url.hostname.toLowerCase())) {
    throw new Error(`The ${name} address must be one of ${name}'s own, starting with https://`);
  }
  return url.toString().replace(/\/$/, '');
};

/** A storage endpoint: https, and in production a public host rather than this machine or a private network. */
export const storageEndpoint = (v: string | undefined, ctx: Pick<ProviderContext, 'production'>) => {
  const text = optional(v);
  if (!text) return undefined;
  const url = new URL(text);
  const host = url.hostname.toLowerCase();
  const local =
    host === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/.test(host);
  if (ctx.production && (url.protocol !== 'https:' || local)) {
    throw new Error('In production the storage endpoint must be a public https address');
  }
  return text;
};

/**
 * Live keys move real money, so they are for production only, and production refuses test keys
 * (docs/security-plan.md, P11). Tells them apart by the prefix each provider gives its keys.
 */
export const isPaystackTestKey = (k: string) => k.startsWith('sk_test_');
export const isPaystackHost = (h: string) => h === 'api.paystack.co';
export const isTermiiHost = (h: string) => h === 'termii.com' || h.endsWith('.termii.com');

export const moneyKey = (
  key: string,
  ctx: Pick<ProviderContext, 'production'>,
  test: (k: string) => boolean,
  name: string,
) => {
  const isTest = test(key);
  if (ctx.production && isTest) throw new Error(`This is a ${name} test key. Production needs a live key.`);
  if (!ctx.production && !isTest) throw new Error(`This is a ${name} live key. Live keys are for production only.`);
  return key;
};
/** A fee admin typed in naira, as kobo; empty is none. Anything else is refused when the settings are saved. */
const nairaFee = (v: string | undefined) => {
  const text = optional(v)?.replace(/[₦,\s]/g, '');
  if (!text) return 0;
  const naira = Number(text);
  if (!Number.isFinite(naira) || naira < 0 || naira > 100_000) throw new Error('The fee must be an amount in naira');
  return Math.round(naira * 100);
};

/**
 * How each provider's adapter is made from the fields admin saved (secrets already decrypted). Every
 * provider in the shared catalogue has a builder here; the test in providers.e2e checks they match.
 */
export const BUILDERS: {
  [C in ProviderCategory]: Record<string, (v: Values, ctx: ProviderContext) => Adapters[C]>;
} = {
  payments: {
    flutterwave: (v, ctx) =>
      new FlutterwavePaymentsAdapter(
        moneyKey(v.secretKey!, ctx, (k) => k.includes('_TEST'), 'Flutterwave'),
        v.secretHash!,
        v.businessName!,
        undefined,
        undefined,
        nairaFee(v.fixedAccountFee),
      ),
    paystack: (v, ctx) =>
      new PaystackPaymentsAdapter(
        moneyKey(v.secretKey!, ctx, isPaystackTestKey, 'Paystack'),
        providerUrl(v.baseUrl, isPaystackHost, 'Paystack'),
        undefined,
        optional(v.dedicatedBank),
        nairaFee(v.fixedAccountFee),
      ),
  },
  sms: {
    africastalking: (v) => new AfricasTalkingMessagingAdapter(v.username!, v.apiKey!, optional(v.senderId)),
    termii: (v) =>
      new TermiiMessagingAdapter(
        v.apiKey!,
        v.senderId!,
        providerUrl(v.baseUrl, isTermiiHost, 'Termii') ?? 'https://api.ng.termii.com',
      ),
  },
  identity: {
    smileid: (v, ctx) =>
      new SmileIdIdentityAdapter(v.partnerId!, v.apiKey!, sandboxMode(v.mode, ctx), v.privacyPolicyUrl!, ctx),
    dojah: (v, ctx) =>
      new DojahIdentityAdapter(
        v.appId!,
        v.secretKey!,
        v.publicKey!,
        v.widgetId!,
        v.webhookSecret!,
        optional(v.customerWidgetId),
        sandboxMode(v.mode, ctx),
        ctx,
      ),
    youverify: (v, ctx) =>
      new YouverifyIdentityAdapter(v.secretKey!, v.publicMerchantKey!, sandboxMode(v.mode, ctx), ctx),
  },
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
    s3: (v, ctx) =>
      new S3StorageAdapter(v.bucket!, v.region!, storageEndpoint(v.endpoint, ctx), {
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
