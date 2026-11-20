/**
 * What the apps look for on a phone and send the server (docs/security-plan.md, MB4). The app's own word, so
 * it adds to Google's and Apple's checks (MB3) rather than standing in for them.
 */
export const RISK_SIGNALS = ['rooted', 'emulator', 'hooking', 'debugger', 'location_spoofer'] as const;
export type RiskSignal = (typeof RISK_SIGNALS)[number];

/** Each signal in words, for staff and the reasons kept with a check. */
export const RISK_LABELS: Record<RiskSignal, string> = {
  rooted: 'A rooted or jailbroken phone',
  emulator: 'An emulator',
  hooking: 'A hooking tool such as Frida',
  debugger: 'A debugger attached',
  location_spoofer: 'A fake-location app installed',
};

/** The known signals in a comma-separated list, each once; anything else is dropped. */
export const riskSignalsOf = (list: string | undefined): RiskSignal[] =>
  [...new Set((list ?? '').split(',').map((s) => s.trim()))].filter((s): s is RiskSignal =>
    (RISK_SIGNALS as readonly string[]).includes(s),
  );

/**
 * What makes a sign-up or sign-in risky (docs/security-plan.md, A10), each with what it adds to the score: what
 * the app found on the phone, a phone several accounts have used, a VPN, and an address in a cloud provider's
 * published ranges (a server, not a phone). A high score asks for more checks; it never stops a sign-in.
 */
export const SIGN_IN_RISKS = [
  'emulator',
  'rooted',
  'hooking',
  'debugger',
  'shared_phone',
  'data_centre',
  'vpn',
] as const;
export type SignInRisk = (typeof SIGN_IN_RISKS)[number];

export const SIGN_IN_RISK_INFO: Record<SignInRisk, { points: number; label: string }> = {
  emulator: { points: 3, label: 'An emulator' },
  hooking: { points: 3, label: 'A hooking tool such as Frida' },
  rooted: { points: 2, label: 'A rooted or jailbroken phone' },
  shared_phone: { points: 2, label: 'A phone several accounts have signed in on' },
  data_centre: { points: 2, label: "An address in a cloud provider's ranges" },
  debugger: { points: 1, label: 'A debugger attached' },
  vpn: { points: 1, label: 'A VPN' },
};

/**
 * The queues flags go to (docs/security-plan.md, E6, I3): errands that look like fraud to the Risk queue,
 * accounts that share a phone or a bank account to verification. Each needs its own permission to decide.
 */
export const RISK_QUEUES = ['risk', 'verification'] as const;
export type RiskQueue = (typeof RISK_QUEUES)[number];

export const RISK_QUEUE_INFO: Record<RiskQueue, { label: string; permission: 'risk' | 'verify' }> = {
  risk: { label: 'Risk', permission: 'risk' },
  verification: { label: 'Verification', permission: 'verify' },
};

/** Why something was flagged. A flag asks a person to look; it never refuses anything by itself. */
export const RISK_FLAG_KINDS = [
  'cash_errand',
  'send_money',
  'same_place',
  'pair_shared_phone',
  'pair_shared_bank',
  'pair_shared_network',
  'repeat_pairing',
  'fast_high_value',
  'gps_jump',
  'gps_straight',
  'no_movement',
  'shared_phone',
  'shared_payout_account',
  'same_face',
  'risky_sign_in',
] as const;
export type RiskFlagKind = (typeof RISK_FLAG_KINDS)[number];

export const RISK_FLAG_INFO: Record<RiskFlagKind, { queue: RiskQueue; label: string; about: string }> = {
  cash_errand: {
    queue: 'risk',
    label: 'Cash',
    about: 'The errand asks the agent to carry or withdraw cash (E5).',
  },
  send_money: {
    queue: 'risk',
    label: 'Send money to an account',
    about: 'The errand asks for money to be sent to a bank account (E5).',
  },
  same_place: {
    queue: 'risk',
    label: 'Ends where it starts',
    about: 'The pickup and the drop-off are the same place (E5).',
  },
  pair_shared_phone: {
    queue: 'risk',
    label: 'Customer and agent share a phone',
    about: "The customer's and the agent's accounts have both been used on one phone (E6).",
  },
  pair_shared_bank: {
    queue: 'risk',
    label: "Topped up from the agent's account",
    about: "The customer's wallet was topped up from a bank account in the name on the agent's payout account (E6).",
  },
  pair_shared_network: {
    queue: 'risk',
    label: 'Customer and agent share a network',
    about: "The customer's and the agent's phones used the same Wi-Fi network or internet address (E6).",
  },
  repeat_pairing: {
    queue: 'risk',
    label: 'Same customer and agent again and again',
    about: 'The same customer and agent have paired up many times in a short while (E6).',
  },
  fast_high_value: {
    queue: 'risk',
    label: 'High value, finished fast',
    about: 'A high-value errand was finished faster than its route can be travelled (E6).',
  },
  gps_jump: {
    queue: 'risk',
    label: 'Impossible jump in position',
    about: "The agent's phone reported moving faster than anyone can travel (G1).",
  },
  gps_straight: {
    queue: 'risk',
    label: 'Trail along a ruler',
    about: "The agent's trail ran perfectly straight at a perfectly even speed, as an app faking a route makes (G1).",
  },
  no_movement: {
    queue: 'risk',
    label: 'Agent never moved',
    about: "The agent's trail stayed in one spot through the errand, though its stops are far apart (E6).",
  },
  shared_phone: {
    queue: 'verification',
    label: 'Phone shared between accounts',
    about: 'Two accounts, at least one of them an agent, have been used on one phone (I3).',
  },
  risky_sign_in: {
    queue: 'risk',
    label: 'Risky sign-in',
    about:
      "A sign-up or sign-in scored high (A10): what the app found on the phone (an emulator, root, hooking tools, a debugger), many accounts on one phone, a VPN, or an address in a cloud provider's ranges.",
  },
  shared_payout_account: {
    queue: 'verification',
    label: 'Bank account on two accounts',
    about: 'Two agents saved the same bank account for their withdrawals (I3).',
  },
  same_face: {
    queue: 'verification',
    label: 'Same face, another account',
    about: "The identity provider found this person's face on another account's ID check (I3).",
  },
};

export const RISK_FLAG_STATUSES = ['open', 'cleared', 'confirmed'] as const;
export type RiskFlagStatus = (typeof RISK_FLAG_STATUSES)[number];
