import { Image } from 'react-native';
import { SvgIcon } from './svg';

/** The 3D category illustrations, at 1x, 2x and 3x; the bundler picks the size for the screen. */
const ART = {
  groceries: require('../../assets/categories/groceries.webp'),
  food: require('../../assets/categories/food.webp'),
  pharmacy: require('../../assets/categories/pharmacy.webp'),
  shopping: require('../../assets/categories/shopping.webp'),
  laundry: require('../../assets/categories/laundry.webp'),
  parcel: require('../../assets/categories/parcel.webp'),
  queue: require('../../assets/categories/queue.webp'),
  other: require('../../assets/categories/other.webp'),
} as const;

export const hasCategoryArt = (key: string) => key in ART;

/** A category's 3D illustration, or its line icon for a category added later without one. */
export function CategoryArt({ categoryKey, icon, size }: { categoryKey: string; icon?: string; size: number }) {
  const source = ART[categoryKey as keyof typeof ART];
  if (!source) return <SvgIcon name={icon ?? 'bag'} size={Math.round(size * 0.6)} />;
  return (
    <Image
      source={source}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
