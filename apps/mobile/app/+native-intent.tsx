import { linkTarget } from '@/links';

/**
 * Every link that opens the app from outside (another app, a web page, a QR code) comes through here first
 * (docs/security-plan.md, MB5): it opens only the screens allowed from outside, with no parameters. Any
 * other link opens the start, or, while the app is open, changes nothing.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  return linkTarget(path, initial);
}
