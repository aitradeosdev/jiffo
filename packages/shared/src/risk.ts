/**
 * What the apps look for on a phone and send the server (docs/security-plan.md, MB4). The app's own word, so
 * it adds to Google's and Apple's checks (MB3) rather than standing in for them.
 */
export const RISK_SIGNALS = ['rooted', 'emulator', 'hooking', 'debugger'] as const;
export type RiskSignal = (typeof RISK_SIGNALS)[number];

/** Each signal in words, for staff and the reasons kept with a check. */
export const RISK_LABELS: Record<RiskSignal, string> = {
  rooted: 'A rooted or jailbroken phone',
  emulator: 'An emulator',
  hooking: 'A hooking tool such as Frida',
  debugger: 'A debugger attached',
};

/** The known signals in a comma-separated list, each once; anything else is dropped. */
export const riskSignalsOf = (list: string | undefined): RiskSignal[] =>
  [...new Set((list ?? '').split(',').map((s) => s.trim()))].filter((s): s is RiskSignal =>
    (RISK_SIGNALS as readonly string[]).includes(s),
  );
