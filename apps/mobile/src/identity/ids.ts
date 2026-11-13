import { ID_TYPES, normaliseIdNumber, type IdType } from '@jiffo/shared';

/** How each ID is asked for in the apps, in the prototype's words. */
export const ID_COPY: Record<
  IdType,
  { short: string; label: string; hint: string; placeholder: string; digits: boolean; max: number; icon: string }
> = {
  nin: {
    short: 'NIN',
    label: 'National Identification Number',
    hint: "Don't know it? Dial *346# from the phone number linked to your NIN.",
    placeholder: '11 digits',
    digits: true,
    max: 11,
    icon: 'shield',
  },
  bvn: {
    short: 'BVN',
    label: 'Bank Verification Number',
    hint: 'Dial *565*0# from the phone number linked to your bank account.',
    placeholder: '11 digits',
    digits: true,
    max: 11,
    icon: 'bank',
  },
  drivers_licence: {
    short: "driver's licence",
    label: "Driver's licence number",
    hint: 'As printed on the front of the licence.',
    placeholder: '9 to 14 characters',
    digits: false,
    max: 14,
    icon: 'card',
  },
  voters_card: {
    short: "voter's card",
    label: 'Voter identification number (VIN)',
    hint: 'The 19 characters on the front of your PVC.',
    placeholder: '19 characters',
    digits: false,
    max: 19,
    icon: 'card',
  },
  passport: {
    short: 'passport',
    label: 'Passport number',
    hint: 'On the photo page of your passport.',
    placeholder: '8 or 9 characters',
    digits: false,
    max: 9,
    icon: 'card',
  },
};

/** Keeps what can be part of the ID's number as it is typed. */
export const cleanIdNumber = (type: IdType, text: string) =>
  ID_COPY[type].digits
    ? text.replace(/\D/g, '').slice(0, ID_COPY[type].max)
    : text
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, ID_COPY[type].max);

/** Whether a number is in the ID's format, as the API checks it. */
export const idNumberOk = (type: IdType, text: string) => normaliseIdNumber(type, text) !== null;

/** The ID's number with all but its last four characters hidden. */
export const maskIdNumber = (text: string) => `${'•'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;

export const idName = (type: IdType) => ID_TYPES[type].name;
