import type { CallsAdapter } from '../adapters/calls';
import type { IdentityAdapter } from '../adapters/identity';
import type { MapsAdapter } from '../adapters/maps';
import type { MessagingAdapter } from '../adapters/messaging';
import type { PaymentsAdapter } from '../adapters/payments';
import type { PushAdapter } from '../adapters/push';
import type { StorageAdapter } from '../adapters/storage';
import type { ProvidersService } from './providers.service';

/*
 * Each service the rest of the API injects (PAYMENTS, MESSAGING and so on) is one of these: it passes every
 * call to whichever provider is switched on at that moment, so a change in the panel needs no restart.
 */

export class SwitchingPayments implements PaymentsAdapter {
  constructor(private readonly providers: ProvidersService) {}
  private get to() {
    return this.providers.current('payments');
  }
  get name() {
    return this.to.name;
  }
  createTransferDeposit(...a: Parameters<PaymentsAdapter['createTransferDeposit']>) {
    return this.to.createTransferDeposit(...a);
  }
  verifyDeposit(...a: Parameters<PaymentsAdapter['verifyDeposit']>) {
    return this.to.verifyDeposit(...a);
  }
  listBanks() {
    return this.to.listBanks();
  }
  resolveAccount(...a: Parameters<PaymentsAdapter['resolveAccount']>) {
    return this.to.resolveAccount(...a);
  }
  createRecipient(...a: Parameters<PaymentsAdapter['createRecipient']>) {
    return this.to.createRecipient(...a);
  }
  transfer(...a: Parameters<PaymentsAdapter['transfer']>) {
    return this.to.transfer(...a);
  }
  verifyTransfer(...a: Parameters<PaymentsAdapter['verifyTransfer']>) {
    return this.to.verifyTransfer(...a);
  }
  balance(...a: Parameters<PaymentsAdapter['balance']>) {
    return this.to.balance(...a);
  }
  parseWebhook(...a: Parameters<PaymentsAdapter['parseWebhook']>) {
    return this.to.parseWebhook(...a);
  }
}

export class SwitchingMessaging implements MessagingAdapter {
  constructor(private readonly providers: ProvidersService) {}
  get name() {
    return this.providers.current('sms').name;
  }
  sendOtp(...a: Parameters<MessagingAdapter['sendOtp']>) {
    return this.providers.current('sms').sendOtp(...a);
  }
}

export class SwitchingPush implements PushAdapter {
  constructor(private readonly providers: ProvidersService) {}
  get name() {
    return this.providers.current('push').name;
  }
  send(...a: Parameters<PushAdapter['send']>) {
    return this.providers.current('push').send(...a);
  }
}

export class SwitchingMaps implements MapsAdapter {
  constructor(private readonly providers: ProvidersService) {}
  get name() {
    return this.providers.current('maps').name;
  }
  autocomplete(...a: Parameters<MapsAdapter['autocomplete']>) {
    return this.providers.current('maps').autocomplete(...a);
  }
  place(...a: Parameters<MapsAdapter['place']>) {
    return this.providers.current('maps').place(...a);
  }
  route(...a: Parameters<MapsAdapter['route']>) {
    return this.providers.current('maps').route(...a);
  }
}

export class SwitchingStorage implements StorageAdapter {
  constructor(private readonly providers: ProvidersService) {}
  get name() {
    return this.providers.current('storage').name;
  }
  presignUpload(...a: Parameters<StorageAdapter['presignUpload']>) {
    return this.providers.current('storage').presignUpload(...a);
  }
  presignDownload(...a: Parameters<StorageAdapter['presignDownload']>) {
    return this.providers.current('storage').presignDownload(...a);
  }
  head(...a: Parameters<StorageAdapter['head']>) {
    return this.providers.current('storage').head(...a);
  }
}

export class SwitchingIdentity implements IdentityAdapter {
  constructor(private readonly providers: ProvidersService) {}
  get name() {
    return this.providers.current('identity').name;
  }
  get flow() {
    return this.providers.current('identity').flow;
  }
  startIdentity(...a: Parameters<IdentityAdapter['startIdentity']>) {
    return this.providers.current('identity').startIdentity(...a);
  }
  identityResult(...a: Parameters<IdentityAdapter['identityResult']>) {
    return this.providers.current('identity').identityResult(...a);
  }
  startAddress(...a: Parameters<IdentityAdapter['startAddress']>) {
    return this.providers.current('identity').startAddress(...a);
  }
  addressResult(...a: Parameters<IdentityAdapter['addressResult']>) {
    return this.providers.current('identity').addressResult(...a);
  }
}

export class SwitchingCalls implements CallsAdapter {
  constructor(private readonly providers: ProvidersService) {}
  get name() {
    return this.providers.current('calls').name;
  }
  bridge(...a: Parameters<CallsAdapter['bridge']>) {
    return this.providers.current('calls').bridge(...a);
  }
}
