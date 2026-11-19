import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { attestedHash } from '../src/attestation/attestation.types';

/** The app's side, written out (apps/mobile/src/auth/attestation.ts), so a drift between the two fails here. */
const appHash = (nonce: string, method: string, path: string, body: string, risk: string) =>
  createHash('sha256')
    .update([nonce, method, path, createHash('sha256').update(body).digest('hex'), `risk:${risk}`].join('\n'))
    .digest();

describe('what an app check covers (MB3, MB4)', () => {
  it('covers the risk signals sent with it, so they can be neither dropped nor changed on the way', () => {
    const body = JSON.stringify({ amountKobo: 100_000 });
    const sent = attestedHash('n-1', 'POST', '/v1/wallet/withdrawals', body, 'rooted,hooking');
    expect(sent).toEqual(appHash('n-1', 'POST', '/v1/wallet/withdrawals', body, 'rooted,hooking'));
    expect(attestedHash('n-1', 'POST', '/v1/wallet/withdrawals', body, '')).not.toEqual(sent);
    expect(attestedHash('n-1', 'POST', '/v1/wallet/withdrawals', body, 'rooted')).not.toEqual(sent);
  });
});
