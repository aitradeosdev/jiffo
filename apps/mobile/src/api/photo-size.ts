/** The longest side the server keeps a photo at (apps/api/src/files/photo-check.ts): no use sending more. */
export const MAX_PHOTO_SIDE = 2560;
/** How much the phone compresses a photo, once, as it saves it as JPEG. */
export const PHOTO_COMPRESS = 0.8;

/** The resize that brings a photo down to MAX_PHOTO_SIDE on its longest side, or null if it is small enough. */
export function photoResize(width: number, height: number): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) <= MAX_PHOTO_SIDE) return null;
  return width >= height ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE };
}
