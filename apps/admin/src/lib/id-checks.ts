/** Customers' ID checks, as the panel shows them. */

export type IdCheckStatus = 'review' | 'checking' | 'failed' | 'verified' | 'declined';

export const ID_CHECK_STATUS: Record<
  IdCheckStatus,
  { label: string; tone: 'neutral' | 'brand' | 'warn' | 'danger'; about: string }
> = {
  review: { label: 'In review', tone: 'warn', about: 'The checks need a person to look' },
  checking: { label: 'Being checked', tone: 'neutral', about: 'Started; the provider is still checking' },
  failed: { label: "Didn't pass", tone: 'danger', about: 'The check failed; they can try again' },
  verified: { label: 'Verified', tone: 'brand', about: 'Can add money and request errands' },
  declined: { label: 'Declined', tone: 'danger', about: 'Turned down by support' },
};

export const idCheckStatus = (status: string) =>
  ID_CHECK_STATUS[status as IdCheckStatus] ?? { label: status, tone: 'neutral' as const, about: '' };
