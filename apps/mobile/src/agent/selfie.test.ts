import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { selfieNeeded, waitForVerdict, withSelfie, type SelfieAnswer } from './selfie';

const needed = (reason?: string) => new ApiError(403, 'selfie_needed', 'Take a quick selfie', reason ? { reason } : {});

describe('selfie checks in the agent app', () => {
  it('knows a refusal for want of a selfie, and what it is for', () => {
    expect(selfieNeeded(needed('new_device'))).toBe('new_device');
    expect(selfieNeeded(needed('payout_change'))).toBe('payout_change');
    expect(selfieNeeded(needed())).toBe('daily');
    expect(selfieNeeded(new ApiError(403, 'pin_wrong', 'Wrong PIN'))).toBeNull();
    expect(selfieNeeded(new Error('offline'))).toBeNull();
  });

  it('takes the selfie and runs the action once more, only when the server asked', async () => {
    const take = vi.fn(async () => true);
    const action = vi.fn().mockRejectedValueOnce(needed('new_device')).mockResolvedValueOnce('sent');
    expect(await withSelfie(action, take)).toBe('sent');
    expect(take).toHaveBeenCalledWith('new_device');
    expect(action).toHaveBeenCalledTimes(2);

    // Not passed: nothing is sent again.
    const again = vi.fn().mockRejectedValue(needed());
    expect(await withSelfie(again, async () => false)).toBeNull();
    expect(again).toHaveBeenCalledTimes(1);

    // Any other error is the action's own.
    const other = new ApiError(409, 'withdrawals_held', 'Paused');
    await expect(withSelfie(() => Promise.reject(other), take)).rejects.toBe(other);
  });

  it('waits for the verdict, and gives up after a while', async () => {
    const answers: SelfieAnswer[] = [{ status: 'pending' }, { status: 'pending' }, { status: 'passed' }];
    const finish = vi.fn(async () => answers.shift()!);
    expect(await waitForVerdict(finish, { sleep: async () => undefined })).toEqual({ status: 'passed' });
    expect(finish).toHaveBeenCalledTimes(3);

    let clock = 0;
    const stuck = vi.fn(async (): Promise<SelfieAnswer> => ({ status: 'pending' }));
    const answer = await waitForVerdict(stuck, {
      every: 1_000,
      timeoutMs: 5_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(answer).toEqual({ status: 'pending' });
    expect(stuck).toHaveBeenCalledTimes(6);
  });
});
