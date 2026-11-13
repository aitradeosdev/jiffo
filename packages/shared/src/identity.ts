/** ID types the Nigeria country adapter knows. Another country adds its own. */
export const ID_TYPES = {
  nin: { name: 'NIN slip or card', pattern: /^\d{11}$/ },
  bvn: { name: 'BVN', pattern: /^\d{11}$/ },
  drivers_licence: { name: "Driver's licence", pattern: /^[A-Z0-9]{9,14}$/ },
  voters_card: { name: "Voter's card (PVC)", pattern: /^[A-Z0-9]{19}$/ },
  passport: { name: 'International passport', pattern: /^[A-Z][0-9]{8}$|^[A-Z0-9]{8,9}$/ },
} as const;

export type IdType = keyof typeof ID_TYPES;
export const ID_TYPE_KEYS = Object.keys(ID_TYPES) as [IdType, ...IdType[]];

/** Strips spaces and checks an ID number against its type's format. */
export function normaliseIdNumber(type: IdType, value: string): string | null {
  const clean = value.replace(/\s+/g, '').toUpperCase();
  return ID_TYPES[type].pattern.test(clean) ? clean : null;
}

/** Whole years from a YYYY-MM-DD date of birth to `now`, counting a birthday only once it has come. */
export function yearsOld(dateOfBirth: string, now = new Date()): number {
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  const years = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  return beforeBirthday ? years - 1 : years;
}
