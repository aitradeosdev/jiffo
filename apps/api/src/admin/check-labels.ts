/** A check as support reads it: its key, result and the provider's note. */
export type Check = { key: string; outcome: string; note?: string };

/** The identity checks as support reads them, for customers and agents alike; each adds its own. */
export const SUPPORT_CHECK_LABELS: Record<string, string> = {
  nin: 'NIN matches their details',
  bvn: 'BVN matches their details',
  drivers_licence: "Driver's licence matches their details",
  voters_card: "Voter's card matches their details",
  passport: 'Passport matches their details',
  id_type: 'An ID we accept',
  selfie: 'Selfie matches the ID photo',
  age: '18 or older',
};
