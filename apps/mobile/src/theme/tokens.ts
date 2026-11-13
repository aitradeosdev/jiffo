/** Colours from the prototypes (docs/prototypes), light and dark. */
export const light = {
  bg: '#FFFFFF',
  bg2: '#F6F6F6',
  surface: '#FFFFFF',
  surface2: '#F3F3F3',
  surface3: '#E8E8E8',
  line: '#EEEEEE',
  line2: '#E2E2E2',
  ink: '#000000',
  ink2: '#3B3B3B',
  ink3: '#6B6B6B',
  onInk: '#FFFFFF',
  brand: '#0A7A4A',
  brand2: '#0E9A5C',
  brandSoft: '#E5F4EC',
  brandInk: '#08603B',
  onBrand: '#FFFFFF',
  urgent: '#C2410C',
  urgentSoft: '#FFF0E5',
  blue: '#276EF1',
  blueSoft: '#E7EFFF',
  danger: '#C62828',
  dangerSoft: '#FDEBEB',
  onDanger: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.48)',
  /** The promo card's background. */
  promo: '#0A3B26',
};

export type Palette = typeof light;

export const dark: Palette = {
  bg: '#000000',
  bg2: '#0F0F0F',
  surface: '#141414',
  surface2: '#1F1F1F',
  surface3: '#2B2B2B',
  line: '#242424',
  line2: '#333333',
  ink: '#FFFFFF',
  ink2: '#CFCFCF',
  ink3: '#A6A6A6',
  onInk: '#000000',
  brand: '#3DD68C',
  brand2: '#3DD68C',
  brandSoft: '#0F2B1D',
  brandInk: '#7FE6B2',
  onBrand: '#03140A',
  urgent: '#FB923C',
  urgentSoft: '#331C0C',
  blue: '#5B93F5',
  blueSoft: '#14223D',
  danger: '#F87171',
  dangerSoft: '#351414',
  onDanger: '#1A0404',
  scrim: 'rgba(0,0,0,0.66)',
  promo: '#0F2B1D',
};

export const fonts = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  extrabold: 'Figtree_800ExtraBold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
