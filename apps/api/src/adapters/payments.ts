import { createHmac, timingSafeEqual } from 'node:crypto';
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
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }>;
  createRecipient(input: { name: string; bankCode: string; accountNumber: string }): Promise<{ recipientCode: string }>;
  transfer(input: {
    reference: string;
    amountKobo: number;
    recipientCode: string;
    reason: string;
  }): Promise<TransferResult>;
  verifyTransfer(reference: string): Promise<{ status: TransferStatus; reason?: string; feeKobo?: number }>;
  /** Cash the provider holds for us, for the daily reconciliation. */
  balance(currency: string): Promise<number>;
  /** Checks the signature and returns the event, or null when the signature is wrong. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhook | null;
}

export const PAYMENTS = Symbol('PAYMENTS');

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
function classify(body: { event?: string; data?: Record<string, unknown> }): PaymentWebhook {
  const data = body.data ?? {};
  const reference = String(data.reference ?? '');
  const eventKey = `${body.event}:${String(data.id ?? reference)}`;
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
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw unavailable('payments_unavailable', 'Payments are not reachable right now. Try again shortly.');
    }
    const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
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
    return classify(JSON.parse(rawBody.toString('utf8')));
  }
}

export class PaystackError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
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

  async createTransferDeposit(input: { reference: string; amountKobo: number; expiresAt: Date }) {
    this.deposits.set(input.reference, {
      amountKobo: input.amountKobo,
      status: 'pending',
      paidKobo: 0,
      senderName: null,
    });
    if (this.autoPayAfterMs > 0) {
      setTimeout(() => {
        if (this.deposits.get(input.reference)?.status === 'pending') this.pay(input.reference);
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

  async resolveAccount(bankCode: string, accountNumber: string) {
    const name = this.accounts.get(`${bankCode}:${accountNumber}`);
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
    return classify(JSON.parse(rawBody.toString('utf8')));
  }
}
