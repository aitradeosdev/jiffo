import { describe, expect, it } from 'vitest';
import { approvalLine } from './release';

describe('a drop-off photo waiting for the customer (X1, X2)', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();

  it('says when it approves itself, from the time the server gives', () => {
    expect(approvalLine({ dueAt: at(22), pausedAt: null }, now)).toBe('It approves itself in 22 hours');
    expect(approvalLine({ dueAt: at(1), pausedAt: null }, now)).toBe('It approves itself in 1 hour');
    expect(approvalLine({ dueAt: at(0.2), pausedAt: null }, now)).toBe('It approves itself in less than an hour');
  });

  it('says when support has paused it', () => {
    expect(approvalLine({ dueAt: at(5), pausedAt: at(-1) }, now)).toMatch(/support paused/);
  });

  it('falls back to 24 hours when the server says nothing', () => {
    expect(approvalLine(undefined, now)).toBe('It approves itself in 24 hours');
  });
});
