import { addDays, businessDate, daysRemaining, isOpenAt, nextBusinessDayStart, startOfBusinessDay } from './time';
import { decodeQrPayload, encodeQrPayload } from './qr';

const TZ = 'Asia/Hebron';

describe('businessDate', () => {
  it('uses local midnight in Asia/Hebron, not UTC', () => {
    // Winter (UTC+2): 2026-01-15 22:30Z is 00:30 local on 2026-01-16
    expect(businessDate(new Date('2026-01-15T22:30:00Z'), TZ)).toBe('2026-01-16');
    expect(businessDate(new Date('2026-01-15T21:59:59Z'), TZ)).toBe('2026-01-15');
    // Summer (UTC+3): 2026-07-15 21:00Z is 00:00 local on 2026-07-16
    expect(businessDate(new Date('2026-07-15T21:00:00Z'), TZ)).toBe('2026-07-16');
    expect(businessDate(new Date('2026-07-15T20:59:59Z'), TZ)).toBe('2026-07-15');
  });

  it('is a calendar day, not a rolling 24h window', () => {
    const lateNight = new Date('2026-01-15T21:50:00Z'); // 23:50 local
    const afterMidnight = new Date('2026-01-15T22:10:00Z'); // 00:10 local, 20 minutes later
    expect(businessDate(lateNight, TZ)).not.toBe(businessDate(afterMidnight, TZ));
  });

  it('startOfBusinessDay returns the local midnight instant in winter and summer', () => {
    expect(startOfBusinessDay('2026-01-16', TZ).toISOString()).toBe('2026-01-15T22:00:00.000Z');
    expect(startOfBusinessDay('2026-07-16', TZ).toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });

  it('handles DST transition days (every day has a start and each instant maps to exactly one day)', () => {
    // Scan all of 2026 and 2027 hour by hour: businessDate must be monotonic and
    // startOfBusinessDay(d) must map back to d with the previous second on the prior day.
    let prev = businessDate(new Date('2026-01-01T00:00:00Z'), TZ);
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2028-01-01T00:00:00Z'); t += 3600_000) {
      const d = businessDate(new Date(t), TZ);
      expect(d >= prev).toBe(true);
      prev = d;
    }
    let d = '2026-01-01';
    for (let i = 0; i < 730; i++) {
      const s = startOfBusinessDay(d, TZ);
      expect(businessDate(s, TZ)).toBe(d);
      expect(businessDate(new Date(s.getTime() - 1000), TZ)).toBe(addDays(d, -1));
      d = addDays(d, 1);
    }
  });

  it('day length around DST changes is 23h or 25h, never a rolling 24h', () => {
    const lengths = new Set<number>();
    let d = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      const len = startOfBusinessDay(addDays(d, 1), TZ).getTime() - startOfBusinessDay(d, TZ).getTime();
      lengths.add(len / 3600_000);
      d = addDays(d, 1);
    }
    expect([...lengths].sort()).toEqual([23, 24, 25]);
  });

  it('nextBusinessDayStart', () => {
    expect(nextBusinessDayStart(new Date('2026-01-15T10:00:00Z'), TZ).toISOString()).toBe('2026-01-15T22:00:00.000Z');
  });

  it('respects a configurable zone', () => {
    expect(businessDate(new Date('2026-01-15T23:30:00Z'), 'UTC')).toBe('2026-01-15');
    expect(businessDate(new Date('2026-01-15T23:30:00Z'), 'Asia/Hebron')).toBe('2026-01-16');
  });
});

describe('daysRemaining', () => {
  it('counts calendar days in the zone', () => {
    const now = new Date('2026-01-15T10:00:00Z');
    expect(daysRemaining(now, new Date('2026-01-15T22:00:00Z'), TZ)).toBe(0); // ends at local midnight tonight
    expect(daysRemaining(now, new Date('2026-01-16T22:00:00Z'), TZ)).toBe(1);
    expect(daysRemaining(now, new Date('2026-02-14T22:00:00Z'), TZ)).toBe(30);
    expect(daysRemaining(now, new Date('2026-01-01T00:00:00Z'), TZ)).toBe(0);
  });
});

describe('isOpenAt', () => {
  const hours = [
    { day: 1 as const, open: '09:00', close: '17:00' },
    { day: 5 as const, open: '20:00', close: '02:00' },
  ];
  it('handles normal and overnight intervals', () => {
    // 2026-01-12 is a Monday. 10:00 local = 08:00Z
    expect(isOpenAt(hours, new Date('2026-01-12T08:00:00Z'), TZ)).toBe(true);
    expect(isOpenAt(hours, new Date('2026-01-12T16:00:00Z'), TZ)).toBe(false);
    // Friday 2026-01-16 23:00 local = 21:00Z; Saturday 01:00 local = 23:00Z Friday
    expect(isOpenAt(hours, new Date('2026-01-16T21:00:00Z'), TZ)).toBe(true);
    expect(isOpenAt(hours, new Date('2026-01-16T23:00:00Z'), TZ)).toBe(true);
    expect(isOpenAt(hours, new Date('2026-01-17T01:00:00Z'), TZ)).toBe(false);
    expect(isOpenAt([], new Date(), TZ)).toBeNull();
  });
});

describe('qr payload', () => {
  it('round-trips and rejects garbage', () => {
    const tok = 'a'.repeat(43);
    expect(decodeQrPayload(encodeQrPayload(tok))).toBe(tok);
    expect(decodeQrPayload('https://evil')).toBeNull();
    expect(decodeQrPayload('BTQ1.short')).toBeNull();
    expect(decodeQrPayload('BTQ1.' + 'a'.repeat(40) + '<script>')).toBeNull();
  });
});
