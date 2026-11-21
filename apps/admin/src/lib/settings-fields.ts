import { CUSTOMER_ID_TYPES } from '@jiffo/shared';
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
  | 'optionalText'
  /** A number dialled, such as an emergency number: kept as the digits typed, never as a quantity. */
  | 'digits'
  /** Whole hours, several, typed with commas between them: 2, 12, 20. */
  | 'hoursList';

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
    about:
      "What the apps suggest from the distance. Customers can offer more. These are the country's: a state, city or area can set its own in Places.",
    fields: [
      { path: 'pricing.baseFeeKobo', label: 'Base fee', kind: 'naira' },
      { path: 'pricing.ratePerKmKobo', label: 'Per kilometre', kind: 'naira' },
      { path: 'pricing.minFeeKobo', label: 'Lowest fee allowed', kind: 'naira' },
    ],
  },
  {
    title: 'Fees and commission',
    about:
      'The customer pays the service fee on top of the errand fee; the agent pays commission out of it. A state, city or area can set its own service fee in Places.',
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
    title: 'Adding money',
    about: 'How customers top up their wallet by bank transfer. Keep at least one on.',
    fields: [
      {
        path: 'topUps.oneTimeAccount',
        label: 'One-time account numbers',
        kind: 'bool',
        help: 'The customer chooses an amount and gets an account number for that transfer, open for the time set under Timers. Can only be off while the provider in use issues own account numbers.',
      },
      {
        path: 'topUps.fixedAccount',
        label: 'Own account number for each customer',
        kind: 'bool',
        help: 'Issued once by the payments provider, after the customer gives their BVN; any transfer to it lands in their wallet. Only offered when the provider in use issues them (see Providers). Turning it off stops new ones; numbers already issued keep working. What issuing costs is counted under Money.',
      },
    ],
  },
  {
    title: 'Limits',
    about: 'Caps that protect new accounts and the payment flows.',
    fields: [
      { path: 'limits.newCustomerItemLimitKobo', label: 'New customer: items per errand, at most', kind: 'naira' },
      {
        path: 'limits.newCustomerErrands',
        label: 'A customer is new until this many finished errands',
        kind: 'count',
      },
      { path: 'limits.newAgentItemLimitKobo', label: 'New agent: items per errand, at most', kind: 'naira' },
      { path: 'limits.newAgentDailyWithdrawalKobo', label: 'New agent: withdrawals per day, at most', kind: 'naira' },
      { path: 'limits.strikeThreshold', label: 'Strikes before review', kind: 'count' },
      { path: 'limits.pinAttempts', label: 'Wrong hand-off PINs allowed', kind: 'count' },
      { path: 'limits.otpAttempts', label: 'Wrong sign-in codes allowed', kind: 'count' },
      { path: 'limits.otpPerQuarterHour', label: 'Sign-in codes per number or phone, in 15 minutes', kind: 'count' },
      { path: 'limits.otpPerDay', label: 'Sign-in codes per number or phone, in a day', kind: 'count' },
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
        path: 'identity.customerCheck',
        label: 'Customers check their ID',
        kind: 'bool',
        help: "Before adding money or requesting an errand. Off: customers do both without one, and the app doesn't ask.",
      },
      {
        path: 'identity.agentCheck',
        label: 'Agents check their ID',
        kind: 'bool',
        help: "In their application, with selfie checks after. Off: no ID or selfie checks, and staff decide every application. Switched back on, agents approved without one go back to their application, offline, until they've checked it.",
      },
      {
        path: 'identity.customerIdTypes',
        label: 'IDs customers can verify with',
        kind: 'multi',
        // A customer gives their NIN or BVN and takes a selfie; ID documents are for agents.
        options: ID_TYPES.filter((t) => (CUSTOMER_ID_TYPES as readonly string[]).includes(t.value)),
        help: 'The customer gives one of these numbers and takes a selfie, once. ID documents are for agents.',
      },
      {
        path: 'identity.agentIdTypes',
        label: 'IDs agents can verify with',
        kind: 'multi',
        options: ID_TYPES,
        help: 'The agent picks one, and takes a selfie. Only those the identity provider in use checks are offered.',
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
      {
        path: 'identity.checkStartsPerDay',
        label: 'ID checks one account may start a day',
        kind: 'count',
        help: 'Each is a paid check with the provider. After this many, the person waits a day or contacts support.',
      },
    ],
  },
  {
    title: 'Security',
    about: 'Limits that protect the money. Changes here will need a second admin once two-person approval is on.',
    fields: [
      {
        path: 'security.instantWithdrawalAgentDailyKobo',
        label: 'Instant withdrawals per agent per day, at most',
        kind: 'naira',
        help: 'Fee included. Daily withdrawals are not counted.',
      },
      {
        path: 'security.instantWithdrawalPlatformDailyKobo',
        label: 'Instant withdrawals for all agents per day, at most',
        kind: 'naira',
        help: 'Once reached, agents can still choose the daily withdrawal.',
      },
      {
        path: 'security.reconciliationToleranceKobo',
        label: 'Nightly check: shortfall left alone up to',
        kind: 'naira',
        help: 'A larger shortfall at the provider pauses instant withdrawals until finance clears the check.',
      },
      {
        path: 'security.handoffDistanceMeters',
        label: 'Agent must be this near the drop-off to finish',
        kind: 'count',
        help: 'In metres. Marking delivered and the PIN are refused further away. 0 turns the check off.',
      },
      {
        path: 'security.offersPerMinute',
        label: 'Counter-offers per errand per minute, at most',
        kind: 'count',
      },
      {
        path: 'security.positionFreshMinutes',
        label: "Agent's position counts for",
        kind: 'minutes',
        help: 'An older position is not used for the drop-off checks. At most 30. Matching has its own.',
      },
      {
        path: 'security.boardNearKm',
        label: 'Board looks this far from the agent, at most',
        kind: 'count',
        help: 'In kilometres, from where the agent last reported being.',
      },
      {
        path: 'security.ownAccountTriesPerDay',
        label: 'Own account number: failed tries per day',
        kind: 'count',
        help: 'Refusals and times the bank could not be reached both count. After this many, the customer waits a day or contacts support.',
      },
      {
        path: 'security.disputeSplitApprovalKobo',
        label: 'A dispute split needs a second admin when it pays the agent more than',
        kind: 'naira',
        help: 'The fee, the items and any charge to the customer together. ₦0 means every split needs one.',
      },
      {
        path: 'security.busyAgentErrands',
        label: 'Suspending an agent needs a second admin once they have completed',
        kind: 'count',
        help: 'Errands. A newer agent is suspended at once.',
      },
      {
        path: 'security.approvalExpiryHours',
        label: 'A change waiting for a second admin lapses after',
        kind: 'hours',
        help: 'Hours. It must then be asked for again.',
      },
      {
        path: 'security.withdrawalHoldHours',
        label: "Agents' withdrawals pause after a new payout account or phone for",
        kind: 'hours',
        help: "Hours. They are told by push, SMS and email, so a change they didn't make is noticed before money can leave. It can't be switched off.",
      },
      {
        path: 'security.dailySelfie',
        label: 'Agents take a selfie before going online each day',
        kind: 'bool',
        help: 'Compared with the face the identity provider kept from their ID check, so the person working is the agent who was verified. Three failures in a row (Identity, Selfie tries) suspend the account.',
      },
      {
        path: 'security.randomSelfiePercent',
        label: 'Extra selfie checks at random when going online, in %',
        kind: 'count',
        help: 'Out of 100 times an agent goes online, how many ask for one more selfie. 0 is off.',
      },
      {
        path: 'security.attestation',
        label: 'App checks (Play Integrity and App Attest)',
        kind: 'select',
        options: [
          { value: 'record', label: 'Record only' },
          { value: 'enforce', label: 'Enforce' },
          { value: 'off', label: 'Off' },
        ],
        help: 'Whether sign-in and money actions must come from the store app on a real phone. Record only keeps each result for staff. Enforce refuses a failed one and asks a doubtful one for a selfie: turn it on once both are set up for the apps.',
      },
      {
        path: 'security.trailDays',
        label: "Agents' GPS trails are kept for",
        kind: 'count',
        help: 'Days, between 30 and 365. Then deleted, unless the errand is in dispute or a flag on it is still open.',
      },
      {
        path: 'security.idRevealAlertAt',
        label: 'Tell owners when one staff member reveals this many people in a day',
        kind: 'count',
        help: 'Below the daily limit, which refuses any more. The alert is on the Audit log page.',
      },
      {
        path: 'security.staffHoursStart',
        label: 'Staff working hours start at',
        kind: 'count',
        help: 'The hour, 0 to 23, in this country’s time. A money action or ID reveal outside working hours raises an alert for owners.',
      },
      {
        path: 'security.staffHoursEnd',
        label: 'Staff working hours end at',
        kind: 'count',
        help: 'The hour, 1 to 24, after the start. 0 and 24 make every hour a working hour.',
      },
      {
        path: 'security.releaseReminderHours',
        label: 'Remind customers of a drop-off photo after',
        kind: 'hoursList',
        help: 'Hours after the photo, soonest first, with commas between them. Each reminder goes by push and SMS (a paid text). One at or after the automatic approval is never sent.',
      },
      {
        path: 'security.signedLinkMinutes',
        label: 'Links to see a photo last',
        kind: 'minutes',
        help: 'Minutes, at most 60. Photos are never public: the apps and this panel get a fresh link each time they show one.',
      },
      {
        path: 'security.appPinTries',
        label: 'Wrong app PINs before it locks',
        kind: 'count',
        help: 'Between 3 and 10. A locked PIN is reset by signing in again on the phone, which pauses withdrawals.',
      },
      {
        path: 'security.dailyIdReveals',
        label: "People's details one staff member may reveal in a day",
        kind: 'count',
        help: 'Legal names, dates of birth, addresses and emergency contacts are hidden until revealed with a reason. Counted per country. 0 means nobody can.',
      },
      {
        path: 'security.signInCodes',
        label: 'Sign-in codes',
        kind: 'select',
        options: [
          { value: 'live', label: 'Live: sent by text' },
          { value: 'test', label: 'Test: shown in the app' },
        ],
        help: 'Test sends no text: the app shows the code on its code screen, for trying the apps without an SMS provider. Anyone can then sign in to any number in this country, so use it only while nobody real uses the apps here. A production server refuses it unless set up to allow it, and every page of the panel warns while it is on.',
      },
      {
        path: 'security.smsCodesDailyAlert',
        label: 'Alert when sign-in codes sent in a day pass',
        kind: 'count',
        help: 'Each code is a paid SMS. A sudden rise can mean someone is sending codes to numbers they found.',
      },
      {
        path: 'security.lowProviderBalanceKobo',
        label: 'Alert when the provider holds less than',
        kind: 'naira',
        help: 'Checked every 15 minutes. 0 turns it off.',
      },
    ],
  },
  {
    title: 'Matching',
    about:
      'Who may get an errand. Agents see on the board, and may accept, only errands that pass these checks: online, where they are, near enough, in their categories, and with room for it.',
    fields: [
      {
        path: 'matching.locationFreshMinutes',
        label: "Agent's position counts for",
        kind: 'minutes',
        help: 'An agent whose phone last reported longer ago sees no errands and can take none. At most 30.',
      },
      {
        path: 'matching.boardRadiusKm',
        label: 'Pickups this far from the agent, at most',
        kind: 'count',
        help: 'In kilometres, in a straight line, on the board and when accepting.',
      },
      {
        path: 'matching.maxBoardErrands',
        label: 'Errands from the board one agent may hold at once',
        kind: 'count',
        help: 'Scheduled errands taken ahead count. An urgent errand is always held alone.',
      },
      {
        path: 'matching.shortlistSize',
        label: 'Nearest agents whose road travel time is asked for',
        kind: 'count',
        help: 'For each errand, from the maps provider. Each is a paid lookup. At most 25.',
      },
      {
        path: 'matching.fallbackSpeedKmh',
        label: 'Speed when the maps provider gives no travel time',
        kind: 'count',
        help: 'In km/h, over roads taken as 30% longer than a straight line.',
      },
      {
        path: 'matching.weights.travel',
        label: 'Ranking: travel time to the pickup counts for',
        kind: 'count',
        help: 'In percent. The four ranking parts must add up to 100%. Sooner scores higher, none from 30 minutes.',
      },
      {
        path: 'matching.weights.reliability',
        label: 'Ranking: reliability counts for',
        kind: 'count',
        help: 'In percent. Errands finished rather than left after accepting, less for each one left this week.',
      },
      {
        path: 'matching.weights.rating',
        label: 'Ranking: rating counts for',
        kind: 'count',
        help: 'In percent. From 3 stars (none) to 5 (full), over their last 100 rated errands.',
      },
      {
        path: 'matching.weights.waiting',
        label: 'Ranking: time waiting counts for',
        kind: 'count',
        help: 'In percent. Since their last errand or going online, full from an hour, so work is spread fairly.',
      },
      {
        path: 'matching.tierBoosts.bronze',
        label: 'Ranking boost for Bronze agents',
        kind: 'count',
        help: 'Points out of 100 added on top of the score, 0 to 20.',
      },
      {
        path: 'matching.tierBoosts.silver',
        label: 'Ranking boost for Silver agents',
        kind: 'count',
        help: 'Points out of 100 added on top of the score, 0 to 20.',
      },
      {
        path: 'matching.tierBoosts.gold',
        label: 'Ranking boost for Gold agents',
        kind: 'count',
        help: 'Points out of 100 added on top of the score, 0 to 20.',
      },
      {
        path: 'matching.tierBoosts.platinum',
        label: 'Ranking boost for Platinum agents',
        kind: 'count',
        help: 'Points out of 100 added on top of the score, 0 to 20.',
      },
      {
        path: 'matching.newAgentErrands',
        label: "Errands before an agent's own history counts",
        kind: 'count',
        help: "Until then, their reliability and rating are the state's average, so new agents get errands too.",
      },
      {
        path: 'matching.fakeGpsHoldHours',
        label: 'A fake-GPS flag keeps the agent from errands for',
        kind: 'hours',
        help: 'From when it was raised, unless staff clear it sooner. 0: the flag alone keeps no one off.',
      },
    ],
  },
  {
    title: 'Risk flags',
    about:
      'When errands go to the Risk queue for a person to look at. Staff decide, and flagged errands leave the counts used for agent tiers until cleared. A customer and an agent who share a phone, bank account, network or face are not matched until staff clear the flag. Working together often, or one errand that looked unusual, keeps them apart only once confirmed.',
    fields: [
      {
        path: 'risk.samePlaceMeters',
        label: 'Pickup and drop-off count as the same place within',
        kind: 'count',
        help: 'In metres. 0 turns this flag off.',
      },
      {
        path: 'risk.repeatPairingErrands',
        label: 'Flag the same customer and agent after this many errands',
        kind: 'count',
        help: 'Counted over the days below. Later errands of the pair join the same flag.',
      },
      {
        path: 'risk.repeatPairingDays',
        label: 'Days the errands above are counted over',
        kind: 'count',
      },
      {
        path: 'risk.sharedNetworkDays',
        label: 'A network both used counts as shared within',
        kind: 'count',
        help: "Days. The customer's and agent's phones on one Wi-Fi network or address. Phone networks and VPNs aren't counted: thousands share their addresses.",
      },
      {
        path: 'risk.busyNetworkAccounts',
        label: 'Ignore an address used by more accounts than',
        kind: 'count',
        help: "Over the same days. A shop's, an office's or a campus's Wi-Fi is used by many.",
      },
      {
        path: 'risk.gpsMaxSpeedKmh',
        label: "Flag an agent's phone moving faster than",
        kind: 'count',
        help: 'In km/h, between two reports. Only moves longer than the distance below count.',
      },
      {
        path: 'risk.gpsJumpMeters',
        label: 'Count a move as a jump from',
        kind: 'count',
        help: "In metres. A phone's GPS wanders a few hundred metres at times; that isn't a jump.",
      },
      {
        path: 'risk.noMovementMeters',
        label: 'Flag an errand whose agent stayed within',
        kind: 'count',
        help: 'In metres, over five minutes or more, when the pickup and drop-off are more than twice this apart. 0 turns it off.',
      },
      {
        path: 'risk.fastHighValueKobo',
        label: 'Flag errands finished unusually fast when worth at least',
        kind: 'naira',
        help: 'The fee and the items together.',
      },
      {
        path: 'risk.fastErrandMinutes',
        label: 'Unusually fast: delivered within',
        kind: 'minutes',
        help: 'Of being accepted, or faster than the route takes at 60 km/h, whichever is longer.',
      },
      {
        path: 'risk.signInRiskAccounts',
        label: 'A sign-in is risky on a phone this many accounts have used',
        kind: 'count',
        help: 'Counting the account signing in, over 90 days.',
      },
      {
        path: 'risk.signInRiskStepUpAt',
        label: 'Ask for more checks at a sign-in risk score of',
        kind: 'count',
        help: 'An emulator or a hooking tool counts 3; a rooted phone, a shared phone or a server address 2; a VPN or a debugger 1. More checks: a selfie before an agent’s money moves, and a flag in the Risk queue. A sign-in is never refused.',
      },
    ],
  },
  {
    title: 'Safety',
    about: "The apps' emergency button dials this number from the phone and tells the safety team where the person is.",
    fields: [
      {
        path: 'safety.emergencyNumber',
        label: 'Emergency number',
        kind: 'digits',
        help: '2 to 6 digits, as dialled in the country. 112 in Nigeria.',
      },
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
    case 'hoursList':
      return (value as number[]).map((h) => `${h} h`).join(', ') || 'none';
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
