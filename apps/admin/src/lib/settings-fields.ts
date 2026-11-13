/**
 * The country settings as the panel shows them: each setting's label, the unit it is typed in, and a line of
 * help. Paths follow CountrySettingsSchema in @jiffo/shared; the API checks every save against it.
 */
export type FieldKind =
  | 'naira'
  | 'optionalNaira'
  | 'percent'
  | 'optionalPercent'
  | 'minutes'
  | 'hours'
  | 'seconds'
  | 'count'
  | 'bool'
  | 'select'
  | 'multi'
  | 'optionalText';

export interface Field {
  path: string;
  label: string;
  kind: FieldKind;
  help?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface Section {
  title: string;
  about: string;
  fields: Field[];
}

const ID_TYPES = [
  { value: 'nin', label: 'NIN' },
  { value: 'bvn', label: 'BVN' },
  { value: 'drivers_licence', label: "Driver's licence" },
  { value: 'voters_card', label: "Voter's card" },
  { value: 'passport', label: 'Passport' },
];

export const SECTIONS: Section[] = [
  {
    title: 'Suggested errand fee',
    about: 'What the apps suggest from the distance. Customers can offer more.',
    fields: [
      { path: 'pricing.baseFeeKobo', label: 'Base fee', kind: 'naira' },
      { path: 'pricing.ratePerKmKobo', label: 'Per kilometre', kind: 'naira' },
      { path: 'pricing.minFeeKobo', label: 'Lowest fee allowed', kind: 'naira' },
    ],
  },
  {
    title: 'Fees and commission',
    about: 'The customer pays the service fee on top of the errand fee; the agent pays commission out of it.',
    fields: [
      { path: 'fees.serviceFeeBps', label: 'Service fee', kind: 'percent', help: 'Of the errand fee' },
      { path: 'fees.serviceFeeMinKobo', label: 'Service fee, at least', kind: 'naira' },
      { path: 'fees.serviceFeeCapKobo', label: 'Service fee, at most', kind: 'naira' },
      { path: 'fees.commissionBps.bronze', label: 'Commission, Bronze', kind: 'percent' },
      { path: 'fees.commissionBps.silver', label: 'Commission, Silver', kind: 'percent' },
      { path: 'fees.commissionBps.gold', label: 'Commission, Gold', kind: 'percent' },
      { path: 'fees.commissionBps.platinum', label: 'Commission, Platinum', kind: 'percent' },
      {
        path: 'fees.launchCommissionBps',
        label: 'Launch commission',
        kind: 'optionalPercent',
        help: 'One rate for every tier while set. Leave empty to use the tier rates.',
      },
      { path: 'fees.instantWithdrawalFeeKobo', label: 'Instant withdrawal fee', kind: 'naira' },
    ],
  },
  {
    title: 'Timers',
    about: 'How long each step waits before the app moves it on.',
    fields: [
      { path: 'timers.urgentWidenMinutes', label: 'Urgent: widen the search after', kind: 'minutes' },
      { path: 'timers.raisePricePromptMinutes', label: 'Suggest raising the fee after', kind: 'minutes' },
      { path: 'timers.urgentExpiryMinutes', label: 'Urgent errand expires after', kind: 'minutes' },
      { path: 'timers.boardRaisePromptMinutes', label: 'Board: suggest raising the fee after', kind: 'minutes' },
      { path: 'timers.itemLockMinutes', label: 'Customer must lock the item amount within', kind: 'minutes' },
      { path: 'timers.dropoffWaitMinutes', label: 'Agent waits at the drop-off for', kind: 'minutes' },
      { path: 'timers.autoReleaseHours', label: 'Drop-off photo approved by itself after', kind: 'hours' },
      { path: 'timers.unreachableHours', label: 'Unreachable customer goes to a dispute after', kind: 'hours' },
      { path: 'timers.disputeResponseHours', label: 'Each side has to respond to a dispute within', kind: 'hours' },
      { path: 'timers.disputeDecisionHours', label: 'Support decides a dispute within', kind: 'hours' },
      { path: 'timers.bronzePayoutHoldHours', label: 'Bronze earnings held for', kind: 'hours' },
      { path: 'timers.depositAccountMinutes', label: 'Top-up account number open for', kind: 'minutes' },
    ],
  },
  {
    title: 'Limits',
    about: 'Caps that protect new accounts and the payment flows.',
    fields: [
      { path: 'limits.newCustomerItemLimitKobo', label: 'New customer: items per errand, at most', kind: 'naira' },
      { path: 'limits.newAgentItemLimitKobo', label: 'New agent: items per errand, at most', kind: 'naira' },
      { path: 'limits.newAgentDailyWithdrawalKobo', label: 'New agent: withdrawals per day, at most', kind: 'naira' },
      { path: 'limits.strikeThreshold', label: 'Strikes before review', kind: 'count' },
      { path: 'limits.pinAttempts', label: 'Wrong hand-off PINs allowed', kind: 'count' },
      { path: 'limits.otpAttempts', label: 'Wrong sign-in codes allowed', kind: 'count' },
      { path: 'limits.otpPerHour', label: 'Sign-in codes per number per hour', kind: 'count' },
      { path: 'limits.otpResendSeconds', label: 'Wait before resending a code', kind: 'seconds' },
      { path: 'limits.otpTtlSeconds', label: 'Sign-in code works for', kind: 'seconds' },
      { path: 'limits.minDepositKobo', label: 'Smallest top-up', kind: 'naira' },
      {
        path: 'limits.maxDepositKobo',
        label: 'Largest top-up',
        kind: 'optionalNaira',
        help: 'Leave empty for no limit.',
      },
      { path: 'limits.minWithdrawalKobo', label: 'Smallest withdrawal', kind: 'naira' },
    ],
  },
  {
    title: 'Identity checks',
    about: 'Which documents people can verify with, and how.',
    fields: [
      {
        path: 'identity.customerIdTypes',
        label: 'IDs customers can verify with',
        kind: 'multi',
        options: ID_TYPES,
        help: 'The customer picks one. Only those the identity provider in use checks are offered.',
      },
      {
        path: 'identity.agentIdTypes',
        label: 'IDs agents can verify with',
        kind: 'multi',
        options: ID_TYPES,
        help: 'The agent picks one. Only those the identity provider in use checks are offered.',
      },
      {
        path: 'identity.requireBvnForAgents',
        label: 'Agents must also give their BVN',
        kind: 'bool',
        help: "Checked alongside their ID, or used as their ID with a provider that can't check both.",
      },
      {
        path: 'identity.addressCheck',
        label: 'Address check',
        kind: 'select',
        options: [
          { value: 'physical', label: 'Physical visit' },
          { value: 'digital', label: 'Digital' },
        ],
      },
      { path: 'identity.selfieTries', label: 'Selfie tries', kind: 'count' },
      { path: 'identity.reviewTargetHours', label: 'Review within', kind: 'hours' },
    ],
  },
  {
    title: 'Profiles',
    about: 'What each side sees of the other.',
    fields: [
      {
        path: 'profiles.showCustomerPhotoBeforeAccept',
        label: "Agents see the customer's photo before accepting",
        kind: 'bool',
      },
    ],
  },
];

export const FIELD_BY_PATH = new Map(SECTIONS.flatMap((s) => s.fields.map((f) => [f.path, f] as const)));

/** A stored value as the panel shows it: naira for kobo, percent for basis points. */
export function shown(field: Field | undefined, value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (!field) return JSON.stringify(value);
  switch (field.kind) {
    case 'naira':
    case 'optionalNaira':
      return `₦${(Number(value) / 100).toLocaleString('en-NG')}`;
    case 'percent':
    case 'optionalPercent':
      return `${Number(value) / 100}%`;
    case 'minutes':
      return `${value} min`;
    case 'hours':
      return `${value} h`;
    case 'seconds':
      return `${value} s`;
    case 'bool':
      return value ? 'yes' : 'no';
    case 'select':
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    case 'multi':
      return (value as string[]).map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ');
    default:
      return String(value);
  }
}

export const getAt = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

export function setAt<T>(obj: T, path: string, value: unknown): T {
  const copy = structuredClone(obj) as Record<string, unknown>;
  const keys = path.split('.');
  let node = copy;
  for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
  node[keys.at(-1)!] = value;
  return copy as T;
}

/** Category icons the apps can draw, from their icon set. */
export const CATEGORY_ICONS = [
  'cart',
  'food',
  'pill',
  'bag',
  'shirt',
  'box',
  'users',
  'spark',
  'gift',
  'doc',
  'home',
  'work',
  'card',
  'route',
  'zap',
  'tune',
  'star',
  'globe',
  'trophy',
  'camera',
  'receipt',
];
