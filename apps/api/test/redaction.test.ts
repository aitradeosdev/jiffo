import { describe, expect, it, vi } from 'vitest';
import { RedactingLogger } from '../src/common/logger';
import { originAllowed } from '../src/common/origins';
import { redact, scrub } from '../src/common/redact';

describe('stored provider payloads', () => {
  it('mask numbers and names, however the keys are written and however deep', () => {
    const stored = redact({
      event: 'charge.success',
      data: {
        reference: 'jd-123',
        amount: 500_000,
        customer: { first_name: 'Ada', last_name: 'Obi', email: 'ada@example.com', name: 'Ada Obi' },
        customer_nin: '12345678901',
        ninNumber: '12345678901',
        bank_account: { number: '0123456789', name: 'Ada Obi' },
        phone: { country: '234', number: '8031234567' },
        authorization: { sender_bank_account_number: '0123456789', sender_name: 'Ada Obi', bank: 'GTBank' },
        dedicated_account: { account_name: 'JIFFO/ADA OBI', account_number: '9912345678', bank: { name: 'Wema' } },
      },
    });
    const text = JSON.stringify(stored);
    for (const secret of ['12345678901', '0123456789', '8031234567', '9912345678', 'ada@example.com', 'Obi', 'OBI']) {
      expect(text).not.toContain(secret);
    }
    // What support needs to find the record is kept.
    expect(stored.data).toMatchObject({ reference: 'jd-123', amount: 500_000, authorization: { bank: 'GTBank' } });
    expect(stored.data.bank_account.number).toBe('****6789');
    expect(stored.data.dedicated_account.bank.name).toBe('Wema');
  });
});

describe('log lines', () => {
  it('have emails and long numbers masked, and short ones kept', () => {
    expect(scrub('Account 0123456789 for ada@example.com, +2348031234567, payout jp-12 of 500000')).toBe(
      'Account ****6789 for ****@****, ****4567, payout jp-12 of 500000',
    );
  });

  it('pass through redaction before they are written', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const writeErr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = new RedactingLogger({ json: true });
      logger.warn('Payout failed: account 0123456789 is not valid', 'Payouts');
      logger.error(new Error('Customer ada@example.com not found'));
      const out = [...write.mock.calls, ...writeErr.mock.calls].map((c) => String(c[0])).join('');
      expect(out).toContain('****6789');
      expect(out).not.toContain('0123456789');
      expect(out).not.toContain('ada@example.com');
    } finally {
      write.mockRestore();
      writeErr.mockRestore();
    }
  });
});

describe('live connection origins', () => {
  const list = 'https://admin.jiffoapp.com';
  it('let in the listed origins, the API’s own address and clients that send none', () => {
    expect(originAllowed({ origin: 'https://admin.jiffoapp.com', host: 'api.jiffoapp.com' }, list)).toBe(true);
    expect(originAllowed({ origin: 'https://api.jiffoapp.com', host: 'api.jiffoapp.com' }, list)).toBe(true);
    expect(originAllowed({ host: 'api.jiffoapp.com' }, list)).toBe(true);
  });

  it('turn away any other page, WebSocket included', () => {
    expect(originAllowed({ origin: 'https://evil.example', host: 'api.jiffoapp.com' }, list)).toBe(false);
    expect(originAllowed({ origin: 'not a url', host: 'api.jiffoapp.com' }, list)).toBe(false);
    expect(originAllowed({ origin: 'https://evil.example', host: 'api.jiffoapp.com' }, '*')).toBe(true);
  });
});
