/** Agent applications, as the panel shows them. */

export type ApplicationStatus = 'review' | 'checking' | 'draft' | 'approved' | 'rejected';
export type CheckOutcome = 'passed' | 'failed' | 'review';

export const APPLICATION_STATUS: Record<
  ApplicationStatus,
  { label: string; tone: 'neutral' | 'brand' | 'warn' | 'danger'; about: string }
> = {
  review: { label: 'In review', tone: 'warn', about: 'Checks need a person to look' },
  checking: { label: 'Being checked', tone: 'neutral', about: 'Sent; the provider is still checking' },
  draft: { label: 'Not sent', tone: 'neutral', about: 'Still filling it in' },
  approved: { label: 'Approved', tone: 'brand', about: 'Can go online and take errands' },
  rejected: { label: 'Declined', tone: 'danger', about: 'Turned down by support' },
};

export const OUTCOME: Record<CheckOutcome, { label: string; tone: 'brand' | 'warn' | 'danger' }> = {
  passed: { label: 'Passed', tone: 'brand' },
  review: { label: 'Look at this', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
};

export interface Check {
  key: string;
  label: string;
  outcome: CheckOutcome;
  note?: string;
}

export const statusOf = (status: string) =>
  APPLICATION_STATUS[status as ApplicationStatus] ?? { label: status, tone: 'neutral' as const, about: '' };
