import { safeLinkPath } from '@/links';

/**
 * Every link that opens the app from outside (another app, a web page, a QR code) comes through here first
 * (docs/security-plan.md, MB5): it opens only the screens allowed from outside, with no parameters.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return safeLinkPath(path);
}
