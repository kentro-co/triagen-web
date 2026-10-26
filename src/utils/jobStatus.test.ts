import { describe, expect, it } from 'vitest';
import { getJobDisplayStatus, isJobAcceptingApplications, isJobExpired } from './jobStatus';

// Local-time dates: the deadline is a calendar day and stays open through its end.
const at = (iso: string) => new Date(iso);

describe('job status / application gating', () => {
  it('open job without deadline accepts applications', () => {
    expect(isJobAcceptingApplications({ status: 'open', deadline: null }, at('2026-09-29T12:00:00'))).toBe(true);
  });

  it('deadline day is still open until 23:59:59.999 local time', () => {
    const job = { status: 'open' as const, deadline: '2026-09-29T00:00:00' };
    expect(isJobExpired(job, at('2026-09-29T23:59:59'))).toBe(false);
    expect(isJobExpired(job, at('2026-09-30T00:00:01'))).toBe(true);
    expect(getJobDisplayStatus(job, at('2026-09-30T08:00:00'))).toBe('expired');
  });

  it.each(['paused', 'closed'] as const)('%s job never accepts applications, even before deadline', (status) => {
    const job = { status, deadline: '2099-01-01T00:00:00' };
    expect(isJobAcceptingApplications(job, at('2026-09-29T12:00:00'))).toBe(false);
    expect(getJobDisplayStatus(job)).toBe(status);
  });

  it('closed/paused are never reported as expired', () => {
    expect(isJobExpired({ status: 'closed', deadline: '2000-01-01T00:00:00' })).toBe(false);
  });
});
