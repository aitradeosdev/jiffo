/** The admin roles, as the team page shows them. The API decides what each one may do. */
export const ROLES = [
  { value: 'owner', label: 'Owner', about: 'Everything, including the team and settings' },
  { value: 'operations', label: 'Operations', about: 'Errands, disputes and people' },
  { value: 'finance', label: 'Finance', about: 'Money: refunds, adjustments and payouts' },
  { value: 'support', label: 'Support', about: 'Can look, but not change anything' },
] as const;
