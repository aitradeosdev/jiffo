import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { unavailable } from '../common/errors';

export interface TransferDeposit {
  accountNumber: string;
  accountName: string;
  bankName: string;
  expiresAt: Date;
}

export interface DepositStatus {
  status: 'success' | 'pending' | 'failed';
  /** What actually arrived. Only this is credited. */
  amountKobo: number;
  feesKobo: number;
  currency: string;
  senderName: string | null;
  senderBank: string | null;
}

export type TransferStatus = 'pending' | 'success' | 'failed';

export interface TransferResult {
  status: TransferStatus;
  transferCode: string | null;
  reason?: string;
  /** The provider's own fee for the transfer, taken from its balance on top of the amount. */
  feeKobo?: number;
}

/** A verified webhook, reduced to what the core needs. The core always re-checks with the provider. */
export type PaymentWebhook =
  | { kind: 'deposit'; eventKey: string; reference: string; raw: Record<string, unknown> }
  | { kind: 'transfer'; eventKey: string; reference: string; raw: Record<string, unknown> }
  | { kind: 'ignored'; eventKey: string; event: string; raw: Record<string, unknown> };

export interface Bank {
  code: string;
  name: string;
}

/**
 * Bank-transfer deposits, payouts and account-name checks. Paystack in Nigeria; another country's
 * provider is another implementation. The ledger is never in here: it is part of the core.
 */
export interface PaymentsAdapter {
  readonly name: string;
  /** A one-time account number the customer transfers the exact amount to. */
  createTransferDeposit(input: {
    reference: string;
    amountKobo: number;
    email: string;
    expiresAt: Date;
  }): Promise<TransferDeposit>;
  verifyDeposit(reference: string): Promise<DepositStatus>;
  listBanks(): Promise<Bank[]>;
  /** The name the bank holds for the account, for the own-name check. */
  /**
   * `expectedName` is whose the account should be. Real providers ignore it; the fake uses it in
   * development to name accounts it doesn't know.
   */
  resolveAccount(bankCode: string, accountNumber: string, expectedName?: string): Promise<{ accountName: string }>;
  createRecipient(input: { name: string; bankCode: string; accountNumber: string }): Promise<{ recipientCode: string }>;
  /** The bank details come along for providers that pay straight to them (Flutterwave). */
  transfer(input: {
    reference: string;
    amountKobo: number;
    recipientCode: string;
    bankCode: string;
    accountNumber: string;
    reason: string;
  }): Promise<TransferResult>;
  /**
   * A transfer's status. `transferCode` is the provider's own id from transfer(), when known, for providers
   * that look transfers up by it; without it, by our reference.
   */
  verifyTransfer(
    reference: string,
    transferCode?: string | null,
  ): Promise<{ status: TransferStatus; reason?: string; feeKobo?: number }>;
  /** Cash the provider holds for us, for the daily reconciliation. */
  balance(currency: string): Promise<number>;
  /** Checks the signature and returns the event, or null when the signature is wrong. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhook | null;
}

export const PAYMENTS = Symbol('PAYMENTS');

/** How long a payments provider may take to answer before the request counts as not reaching it. */
const PAYMENTS_TIMEOUT_MS = 20_000;

/**
 * A request to a payments provider and its JSON answer. No answer at all (network, timeout) is said as
 * payments being unreachable; reading the answer is left to the provider's adapter.
 */
async function paymentsRequest<T>(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PAYMENTS_TIMEOUT_MS) });
  } catch {
    throw unavailable('payments_unavailable', 'Payments are not reachable right now. Try again shortly.');
  }
  return { res, json: (await res.json().catch(() => null)) as T | null };
}

/** A webhook's key for recognising a repeat: the provider's id, or, without one, the body itself. */
const eventKeyOf = (event: string | undefined, id: unknown, rawBody: Buffer) =>
  `${event ?? 'unknown'}:${id ? String(id) : createHash('sha256').update(rawBody).digest('hex')}`;

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const signatureMatches = (secret: string, rawBody: Buffer, signature: string | undefined) => {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha512', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** Paystack's event names mapped to the two things the core cares about. */
function classify(body: { event?: string; data?: Record<string, unknown> }, rawBody: Buffer): PaymentWebhook {
  const data = body.data ?? {};
  const reference = String(data.reference ?? '');
  const eventKey = eventKeyOf(body.event, data.id ?? reference, rawBody);
  const raw = body as Record<string, unknown>;
  if (body.event === 'charge.success' && reference) return { kind: 'deposit', eventKey, reference, raw };
  if (body.event?.startsWith('transfer.') && reference) return { kind: 'transfer', eventKey, reference, raw };
  return { kind: 'ignored', eventKey, event: body.event ?? 'unknown', raw };
}

const TRANSFER_FAILED = new Set(['failed', 'reversed', 'abandoned', 'blocked', 'rejected']);
const mapTransfer = (status: string): TransferStatus =>
  status === 'success' ? 'success' : TRANSFER_FAILED.has(status) ? 'failed' : 'pending';

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
  meta?: { next?: string | null };
}

/** Paystack: Pay with Transfer for deposits, Transfers for payouts, Resolve Account for name checks. */
export class PaystackPaymentsAdapter implements PaymentsAdapter {
  readonly name = 'paystack';

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return (await this.callWithMeta<T>(method, path, body)).data;
  }

  private async callWithMeta<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<PaystackEnvelope<T>> {
    const { res, json } = await paymentsRequest<PaystackEnvelope<T>>(this.fetchImpl, `${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok || !json?.status)
      throw new PaystackError(res.status, json?.message ?? `Paystack answered ${res.status}`);
    return json;
  }

  async createTransferDeposit(input: { reference: string; amountKobo: number; email: string; expiresAt: Date }) {
    const data = await this.call<{
      account_number: string;
      account_name: string;
      bank: { name: string };
      account_expires_at?: string;
    }>('POST', '/charge', {
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      bank_transfer: { account_expires_at: input.expiresAt.toISOString() },
    });
    return {
      accountNumber: data.account_number,
      accountName: data.account_name,
      bankName: data.bank.name,
      expiresAt: data.account_expires_at ? new Date(data.account_expires_at) : input.expiresAt,
    };
  }

  async verifyDeposit(reference: string): Promise<DepositStatus> {
    const data = await this.call<{
      status: string;
      amount: number;
      fees: number | null;
      currency: string;
      authorization?: { sender_name?: string | null; sender_bank?: string | null } | null;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const status =
      data.status === 'success'
        ? 'success'
        : ['failed', 'abandoned', 'reversed'].includes(data.status)
          ? 'failed'
          : 'pending';
    return {
      status,
      amountKobo: data.amount,
      feesKobo: data.fees ?? 0,
      currency: data.currency,
      senderName: data.authorization?.sender_name ?? null,
      senderBank: data.authorization?.sender_bank ?? null,
    };
  }

  async listBanks() {
    const banks: Bank[] = [];
    let next: string | null | undefined;
    do {
      const page = await this.callWithMeta<Array<{ code: string; name: string; active: boolean }>>(
        'GET',
        `/bank?country=nigeria&currency=NGN&perPage=100&use_cursor=true${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      );
      banks.push(...page.data.filter((b) => b.active).map((b) => ({ code: b.code, name: b.name })));
      next = page.meta?.next;
    } while (next);
    return banks;
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const data = await this.call<{ account_name: string }>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return { accountName: data.account_name };
  }

  async createRecipient(input: { name: string; bankCode: string; accountNumber: string }) {
    const data = await this.call<{ recipient_code: string }>('POST', '/transferrecipient', {
      type: 'nuban',
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    });
    return { recipientCode: data.recipient_code };
  }

  async transfer(input: { reference: string; amountKobo: number; recipientCode: string; reason: string }) {
    const data = await this.call<{ status: string; transfer_code?: string; fee_charged?: number }>(
      'POST',
      '/transfer',
      {
        source: 'balance',
        amount: input.amountKobo,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason,
      },
    );
    return {
      status: mapTransfer(data.status),
      transferCode: data.transfer_code ?? null,
      reason: data.status,
      feeKobo: data.fee_charged,
    };
  }

  async verifyTransfer(reference: string) {
    const data = await this.call<{ status: string; fee_charged?: number }>(
      'GET',
      `/transfer/verify/${encodeURIComponent(reference)}`,
    );
    return { status: mapTransfer(data.status), reason: data.status, feeKobo: data.fee_charged };
  }

  async balance(currency: string) {
    const data = await this.call<Array<{ currency: string; balance: number }>>('GET', '/balance');
    return data.find((b) => b.currency === currency)?.balance ?? 0;
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    if (!signatureMatches(this.secretKey, rawBody, header(headers, 'x-paystack-signature'))) return null;
    return classify(JSON.parse(rawBody.toString('utf8')), rawBody);
  }
}

/** A payments provider refused or failed a request, with the HTTP status it answered. */
export class PaymentsProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentsProviderError';
  }
}

export class PaystackError extends PaymentsProviderError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'PaystackError';
  }
}

/**
 * Development and tests: behaves like Paystack without moving money. Webhooks are signed with
 * the given secret and checked the same way, so the webhook endpoint is exercised for real.
 */
export class FakePaymentsAdapter implements PaymentsAdapter {
  readonly name = 'fake';
  readonly deposits = new Map<
    string,
    { amountKobo: number; status: DepositStatus['status']; paidKobo: number; senderName: string | null }
  >();
  readonly transfers = new Map<string, { amountKobo: number; recipientCode: string; status: TransferStatus }>();
  /** Account names the fake bank knows, by "bankCode:accountNumber". */
  readonly accounts = new Map<string, string>();
  /** The status the next transfer call answers with. */
  nextTransferStatus: TransferStatus = 'pending';
  /** When set, the next transfer call is refused outright, as Paystack does for a bad recipient. */
  rejectNextTransfer: string | null = null;
  transferFeeKobo = 1_000;
  providerBalanceKobo = 0;
  feeBps = 150;

  /**
   * @param autoPayAfterMs Development only: pretend each transfer arrives this long after the account
   * number is issued, so the apps can be tried end to end without moving money. 0 turns it off.
   */
  constructor(
    readonly webhookSecret: string,
    private readonly autoPayAfterMs = 0,
  ) {}

  /** Set by the deposits service, so an auto-paid top-up is applied like one confirmed by webhook. */
  onAutoPaid?: (reference: string) => void;

  async createTransferDeposit(input: { reference: string; amountKobo: number; expiresAt: Date }) {
    this.deposits.set(input.reference, {
      amountKobo: input.amountKobo,
      status: 'pending',
      paidKobo: 0,
      senderName: null,
    });
    if (this.autoPayAfterMs > 0) {
      setTimeout(() => {
        if (this.deposits.get(input.reference)?.status !== 'pending') return;
        this.pay(input.reference);
        // As Paystack would: tell the API the money arrived.
        this.onAutoPaid?.(input.reference);
      }, this.autoPayAfterMs).unref?.();
    }
    return {
      accountNumber: '9900000001',
      accountName: 'Jiffo Checkout',
      bankName: 'Test Bank',
      expiresAt: input.expiresAt,
    };
  }

  /** The customer's transfer arrives. Returns the signed webhook to post to the API. */
  pay(reference: string, options: { amountKobo?: number; senderName?: string } = {}) {
    const deposit = this.deposits.get(reference);
    if (!deposit) throw new Error(`No fake deposit ${reference}`);
    deposit.status = 'success';
    deposit.paidKobo = options.amountKobo ?? deposit.amountKobo;
    deposit.senderName = options.senderName ?? null;
    this.providerBalanceKobo += deposit.paidKobo - this.fee(deposit.paidKobo);
    return this.webhook('charge.success', { id: Math.floor(Math.random() * 1e9), reference });
  }

  private fee(amount: number) {
    return Math.min(Math.floor((amount * this.feeBps) / 10_000), 200_000);
  }

  async verifyDeposit(reference: string): Promise<DepositStatus> {
    const d = this.deposits.get(reference);
    if (!d) throw new PaystackError(404, 'Transaction reference not found');
    return {
      status: d.status,
      amountKobo: d.status === 'success' ? d.paidKobo : d.amountKobo,
      feesKobo: d.status === 'success' ? this.fee(d.paidKobo) : 0,
      currency: 'NGN',
      senderName: d.senderName,
      senderBank: d.senderName ? 'Test Bank' : null,
    };
  }

  async listBanks() {
    return [
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '044', name: 'Access Bank' },
    ];
  }

  /** Accounts named after whoever asked, in development. */
  private readonly assumed = new Set<string>();

  /**
   * Development only: with auto-pay on, an account the fake bank doesn't know is taken to be in the expected
   * name, so a payout account can be added when trying the app end to end. Accounts set up by tests are
   * never renamed.
   */
  async resolveAccount(bankCode: string, accountNumber: string, expectedName?: string) {
    const key = `${bankCode}:${accountNumber}`;
    if (this.autoPayAfterMs > 0 && expectedName && (!this.accounts.has(key) || this.assumed.has(key))) {
      this.accounts.set(key, expectedName.toUpperCase());
      this.assumed.add(key);
    }
    const name = this.accounts.get(key);
    if (!name) throw new PaystackError(422, 'Could not resolve account name');
    return { accountName: name };
  }

  async createRecipient(input: { bankCode: string; accountNumber: string }) {
    return { recipientCode: `RCP_${input.bankCode}_${input.accountNumber}` };
  }

  async transfer(input: { reference: string; amountKobo: number; recipientCode: string }) {
    const existing = this.transfers.get(input.reference);
    if (existing) throw new PaystackError(400, 'Duplicate Transaction Reference');
    if (this.rejectNextTransfer) {
      const message = this.rejectNextTransfer;
      this.rejectNextTransfer = null;
      throw new PaystackError(400, message);
    }
    const status = this.nextTransferStatus;
    this.transfers.set(input.reference, { amountKobo: input.amountKobo, recipientCode: input.recipientCode, status });
    if (status !== 'failed') this.providerBalanceKobo -= input.amountKobo + this.transferFeeKobo;
    return {
      status,
      transferCode: `TRF_${input.reference}`,
      feeKobo: status === 'success' ? this.transferFeeKobo : undefined,
    };
  }

  /** The bank settles (or bounces) a transfer. Returns the signed webhook. */
  settleTransfer(reference: string, status: 'success' | 'failed') {
    const transfer = this.transfers.get(reference);
    if (!transfer) throw new Error(`No fake transfer ${reference}`);
    if (status === 'failed' && transfer.status !== 'failed')
      this.providerBalanceKobo += transfer.amountKobo + this.transferFeeKobo;
    transfer.status = status;
    return this.webhook(status === 'success' ? 'transfer.success' : 'transfer.failed', {
      id: Math.floor(Math.random() * 1e9),
      reference,
    });
  }

  async verifyTransfer(reference: string) {
    const t = this.transfers.get(reference);
    if (!t) throw new PaystackError(404, 'Transfer not found');
    return { status: t.status, feeKobo: t.status === 'success' ? this.transferFeeKobo : undefined };
  }

  async balance() {
    return this.providerBalanceKobo;
  }

  webhook(event: string, data: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify({ event, data }));
    return { body, signature: createHmac('sha512', this.webhookSecret).update(body).digest('hex') };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    if (!signatureMatches(this.webhookSecret, rawBody, header(headers, 'x-paystack-signature'))) return null;
    return classify(JSON.parse(rawBody.toString('utf8')), rawBody);
  }
}

export class FlutterwaveError extends PaymentsProviderError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'FlutterwaveError';
  }
}

interface FlutterwaveEnvelope<T> {
  status: string;
  message: string;
  data: T;
}

/** Flutterwave works in naira; the core in kobo. */
const toKobo = (naira: number | string | null | undefined) => Math.round(Number(naira ?? 0) * 100);
const toNaira = (kobo: number) => Number((kobo / 100).toFixed(2));

const FLW_TRANSFER: Record<string, TransferStatus> = { SUCCESSFUL: 'success', FAILED: 'failed' };

/** A Flutterwave transfer as the core sees it. */
const fromFlwTransfer = (t: { status: string; fee?: number | null; complete_message?: string }) => ({
  status: FLW_TRANSFER[t.status] ?? ('pending' as TransferStatus),
  reason: t.complete_message || t.status,
  feeKobo: t.fee === undefined || t.fee === null ? undefined : toKobo(t.fee),
});

/**
 * Flutterwave's dates, such as "2026-11-13 3:00:00 PM", carry no time zone: they are Lagos time (UTC+1,
 * no summer time). A date with its own zone is read as it is. Null when it can't be read.
 */
export function parseFlutterwaveDate(text: string | undefined): Date | null {
  if (!text) return null;
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(text.trim());
  if (local) {
    const [, y, mo, d, h, mi, sec, ampm] = local;
    let hour = Number(h);
    if (ampm) hour = (hour % 12) + (ampm.toUpperCase() === 'PM' ? 12 : 0);
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hour - 1, Number(mi), Number(sec ?? 0)));
  }
  const zoned = new Date(text);
  return Number.isNaN(zoned.getTime()) ? null : zoned;
}

/** How long a one-time Flutterwave account lasts when its expiry can't be read. */
const FLW_ACCOUNT_MINUTES = 60;

/**
 * Flutterwave (v3). Top-ups are one-time bank-transfer account numbers; payouts are transfers straight to
 * the agent's bank details. Webhooks carry the secret hash set in the Flutterwave dashboard, and every one is
 * checked again with the API before money moves. Endpoints follow Flutterwave's official Node SDK and its
 * v3 API reference.
 */
export class FlutterwavePaymentsAdapter implements PaymentsAdapter {
  readonly name = 'flutterwave';

  constructor(
    private readonly secretKey: string,
    /** The "secret hash" set for webhooks in the Flutterwave dashboard. */
    private readonly secretHash: string,
    /** The name customers see on the account number they transfer to. */
    private readonly businessName: string,
    private readonly baseUrl = 'https://api.flutterwave.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const { res, json } = await paymentsRequest<FlutterwaveEnvelope<T>>(this.fetchImpl, `${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok || json?.status !== 'success') {
      throw new FlutterwaveError(res.status, json?.message ?? `Flutterwave answered ${res.status}`);
    }
    return json.data;
  }

  async createTransferDeposit(input: { reference: string; amountKobo: number; email: string; expiresAt: Date }) {
    const data = await this.call<{ account_number: string; bank_name: string; expiry_date?: string }>(
      'POST',
      '/v3/virtual-account-numbers',
      {
        email: input.email,
        is_permanent: false,
        tx_ref: input.reference,
        amount: toNaira(input.amountKobo),
        narration: this.businessName,
      },
    );
    // The earlier of theirs and ours, so nobody is shown a time after the account stops taking money.
    const theirs = parseFlutterwaveDate(data.expiry_date) ?? new Date(Date.now() + FLW_ACCOUNT_MINUTES * 60_000);
    return {
      accountNumber: data.account_number,
      accountName: this.businessName,
      bankName: data.bank_name,
      expiresAt: theirs < input.expiresAt ? theirs : input.expiresAt,
    };
  }

  async verifyDeposit(reference: string): Promise<DepositStatus> {
    let data: {
      status: string;
      amount: number;
      app_fee?: number | null;
      currency: string;
      meta?: { originatorname?: string; bankname?: string } | null;
    };
    try {
      data = await this.call('GET', `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    } catch (error) {
      // Flutterwave has no payment under this reference yet: still waiting. Any other refusal is an error.
      if (error instanceof FlutterwaveError && /no transaction/i.test(error.message)) {
        return { status: 'pending', amountKobo: 0, feesKobo: 0, currency: 'NGN', senderName: null, senderBank: null };
      }
      throw error;
    }
    const status = data.status === 'successful' ? 'success' : data.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      amountKobo: toKobo(data.amount),
      feesKobo: toKobo(data.app_fee),
      currency: data.currency,
      senderName: data.meta?.originatorname ?? null,
      senderBank: data.meta?.bankname ?? null,
    };
  }

  async listBanks() {
    const data = await this.call<Array<{ code: string; name: string }>>('GET', '/v3/banks/NG');
    return data.map((b) => ({ code: b.code, name: b.name }));
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const data = await this.call<{ account_name: string }>('POST', '/v3/accounts/resolve', {
      account_number: accountNumber,
      account_bank: bankCode,
    });
    return { accountName: data.account_name };
  }

  /** Flutterwave pays straight to bank details: nothing to register, so the code only marks the account. */
  async createRecipient(input: { name: string; bankCode: string; accountNumber: string }) {
    return { recipientCode: `${input.bankCode}:${input.accountNumber}` };
  }

  async transfer(input: {
    reference: string;
    amountKobo: number;
    bankCode: string;
    accountNumber: string;
    reason: string;
  }) {
    let data: { id: number; status: string; fee?: number | null; complete_message?: string };
    try {
      data = await this.call('POST', '/v3/transfers', {
        account_bank: input.bankCode,
        account_number: input.accountNumber,
        amount: toNaira(input.amountKobo),
        narration: input.reason,
        currency: 'NGN',
        debit_currency: 'NGN',
        reference: input.reference,
      });
    } catch (error) {
      // A reference Flutterwave already has means an earlier try may have gone through: not a refusal,
      // so the payout is never given back on it; it is looked up instead.
      if (error instanceof FlutterwaveError && /duplicate|already exist/i.test(error.message)) {
        throw unavailable('payments_unavailable', `Flutterwave already has transfer ${input.reference}`);
      }
      throw error;
    }
    return { transferCode: String(data.id), ...fromFlwTransfer(data) };
  }

  async verifyTransfer(reference: string, transferCode?: string | null) {
    if (transferCode) {
      return fromFlwTransfer(
        await this.call<{ status: string; fee?: number | null; complete_message?: string }>(
          'GET',
          `/v3/transfers/${encodeURIComponent(transferCode)}`,
        ),
      );
    }
    const data = await this.call<
      Array<{ reference: string; status: string; fee?: number | null; complete_message?: string }>
    >('GET', `/v3/transfers?reference=${encodeURIComponent(reference)}`);
    const found = data.find((t) => t.reference === reference);
    // Not found isn't proof it was never made: the state is unknown, which never gives the money back.
    if (!found) throw new Error(`Flutterwave did not list transfer ${reference}`);
    return fromFlwTransfer(found);
  }

  async balance(currency: string) {
    const data = await this.call<{ available_balance: number }>('GET', `/v3/balances/${encodeURIComponent(currency)}`);
    return toKobo(data.available_balance);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhook | null {
    const given = Buffer.from(header(headers, 'verif-hash') ?? '');
    const expected = Buffer.from(this.secretHash);
    if (!this.secretHash || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const body = JSON.parse(rawBody.toString('utf8')) as { event?: string; data?: Record<string, unknown> };
    const data = body.data ?? {};
    const raw = body as Record<string, unknown>;
    const eventKey = eventKeyOf(body.event, data.id ?? data.tx_ref ?? data.reference, rawBody);
    if (body.event === 'charge.completed' && data.tx_ref) {
      return { kind: 'deposit', eventKey, reference: String(data.tx_ref), raw };
    }
    if (body.event === 'transfer.completed' && data.reference) {
      return { kind: 'transfer', eventKey, reference: String(data.reference), raw };
    }
    return { kind: 'ignored', eventKey, event: body.event ?? 'unknown', raw };
  }
}
