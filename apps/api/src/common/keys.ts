import { hkdfSync } from 'node:crypto';
import type { AppConfig } from '../config/app-config';

/** The jobs that each have their own key (docs/security-plan.md, I5). */
export type KeyJob = 'idFingerprint' | 'adminTotp' | 'fields';

const SETTING = { idFingerprint: 'ID_FINGERPRINT_KEY', adminTotp: 'ADMIN_TOTP_KEY', fields: 'FIELD_KEY' } as const;
/** How each key was derived from PIN_KEY before it had its own setting: development keeps these. */
const LABEL: Record<KeyJob, string> = {
  idFingerprint: 'jiffo nin fingerprint',
  adminTotp: 'jiffo admin totp',
  fields: 'jiffo field encryption',
};

const derive = (key: Buffer, label: string) => Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), label, 32));

/**
 * A job's key: its own setting, which production requires (see app-config), or in development a key
 * derived from PIN_KEY for that job alone.
 */
export function keyFor(
  config: Pick<AppConfig, 'PIN_KEY' | 'ID_FINGERPRINT_KEY' | 'ADMIN_TOTP_KEY' | 'FIELD_KEY'>,
  job: KeyJob,
): Buffer {
  const own = config[SETTING[job]];
  return own ? Buffer.from(own, 'hex') : derive(Buffer.from(config.PIN_KEY, 'hex'), LABEL[job]);
}

/** A key for a narrower use, derived from a job's key (the search index of encrypted names). */
export const subKey = (key: Buffer, label: string) => derive(key, label);
