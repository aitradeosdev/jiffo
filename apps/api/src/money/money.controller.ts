import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { ErrandId } from '../common/params';
import { notFound } from '../common/errors';
import { PushService } from '../push/push.service';
import { formatNaira } from '@jiffo/shared';
import { DepositsService } from './deposits.service';
import { FixedAccountsService } from './fixed-accounts.service';
import { PayoutsService } from './payouts.service';
import { WalletService } from './wallet.service';

const Kobo = z.number().int().positive().max(100_000_000_000);
const DepositBody = z.object({ amountKobo: Kobo });
const WithdrawalBody = z.object({
  amountKobo: Kobo,
  speed: z.enum(['instant', 'scheduled']),
  /** The app's key for this request: a repeat with it makes no second withdrawal. */
  requestId: z.string().uuid(),
});
const PayoutAccountBody = z.object({
  bankCode: z.string().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits'),
});
const FixedAccountBody = z.object({
  bvn: z
    .string()
    .regex(/^\d{11}$/, 'A BVN is 11 digits')
    .optional(),
  bankCode: z.string().min(2).max(10).optional(),
  accountNumber: z
    .string()
    .regex(/^\d{10}$/, 'Account numbers are 10 digits')
    .optional(),
});
const TipBody = z.object({ amountKobo: Kobo.max(10_000_000) });
const Page = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const DepositId = new ParseUUIDPipe({ exceptionFactory: () => notFound('deposit_not_found', 'Top-up not found') });

@Controller()
@UseGuards(AuthGuard)
export class MoneyController {
  constructor(
    private readonly wallet: WalletService,
    private readonly deposits: DepositsService,
    private readonly payouts: PayoutsService,
    private readonly push: PushService,
    private readonly fixedAccounts: FixedAccountsService,
  ) {}

  /** Customer app: the balance. Agent app: available and held earnings, and when held money frees up. */
  @Get('wallet')
  summary(@CurrentAuth() auth: AuthContext) {
    return this.wallet.summary(auth);
  }

  @Get('wallet/transactions')
  history(@CurrentAuth() auth: AuthContext, @Query(new ZodBody(Page)) q: z.infer<typeof Page>) {
    return this.wallet.history(auth, q.before, q.limit);
  }

  @Post('wallet/deposits')
  @Apps('customer')
  deposit(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(DepositBody)) body: z.infer<typeof DepositBody>) {
    return this.deposits.create(auth, body.amountKobo);
  }

  @Get('wallet/deposits')
  @Apps('customer')
  listDeposits(@CurrentAuth() auth: AuthContext) {
    return this.deposits.list(auth, 20);
  }

  @Get('wallet/deposits/:id')
  @Apps('customer')
  getDeposit(@CurrentAuth() auth: AuthContext, @Param('id', DepositId) id: string) {
    return this.deposits.get(auth, id);
  }

  /** The ways to add money on offer, and the customer's own account number when they have one. */
  @Get('wallet/top-up')
  @Apps('customer')
  topUpOptions(@CurrentAuth() auth: AuthContext) {
    return this.fixedAccounts.view(auth);
  }

  /** Asks the provider for the customer's own account number. The BVN and bank account are passed on, never kept. */
  @Post('wallet/fixed-account')
  @Apps('customer')
  issueFixedAccount(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBody(FixedAccountBody)) body: z.infer<typeof FixedAccountBody>,
  ) {
    return this.fixedAccounts.issue(auth, body);
  }

  @Post('wallet/withdrawals')
  @Apps('agent')
  withdraw(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(WithdrawalBody)) body: z.infer<typeof WithdrawalBody>) {
    return this.payouts.request(auth, body.amountKobo, body.speed, body.requestId);
  }

  @Get('wallet/withdrawals')
  @Apps('agent')
  listWithdrawals(@CurrentAuth() auth: AuthContext) {
    return this.payouts.list(auth, 30);
  }

  /** Agents choose their payout bank; customers their own bank when a fixed account needs one. */
  @Get('banks')
  banks() {
    return this.payouts.listBanks();
  }

  @Get('payout-account')
  @Apps('agent')
  getPayoutAccount(@CurrentAuth() auth: AuthContext) {
    return this.payouts.getAccount(auth);
  }

  @Put('payout-account')
  @Apps('agent')
  setPayoutAccount(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBody(PayoutAccountBody)) body: z.infer<typeof PayoutAccountBody>,
  ) {
    return this.payouts.setAccount(auth, body.bankCode, body.accountNumber);
  }

  @Post('errands/:id/tip')
  @Apps('customer')
  @HttpCode(201)
  async tip(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ErrandId) id: string,
    @Body(new ZodBody(TipBody)) body: z.infer<typeof TipBody>,
  ) {
    const { agentId, amountKobo } = await this.wallet.tip(auth, id, body.amountKobo);
    await this.push.notifyUser(agentId, 'agent', {
      title: 'You got a tip',
      body: `${formatNaira(amountKobo)} from your customer.`,
      data: { type: 'wallet.tip', errandId: id },
    });
    return { amountKobo };
  }
}
