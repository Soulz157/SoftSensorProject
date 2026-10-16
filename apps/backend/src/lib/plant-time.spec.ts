import { wallClockToUtc } from './plant-time';

describe('wallClockToUtc', () => {
  it('reads a naive frame timestamp as Bangkok wall-clock (UTC+7)', () => {
    expect(wallClockToUtc('2026-10-16 12:56:40')?.toISOString()).toBe(
      '2026-10-16T05:56:40.000Z',
    );
    expect(wallClockToUtc('2026-10-16T12:56:40.763')?.toISOString()).toBe(
      '2026-10-16T05:56:40.763Z',
    );
  });

  it('crosses midnight backwards correctly', () => {
    expect(wallClockToUtc('2026-10-16 03:00:00')?.toISOString()).toBe(
      '2026-10-15T20:00:00.000Z',
    );
  });

  it('passes a value that already has a zone through unchanged', () => {
    expect(wallClockToUtc('2026-10-16T05:56:40.000Z')?.toISOString()).toBe(
      '2026-10-16T05:56:40.000Z',
    );
    expect(wallClockToUtc('2026-10-16T12:56:40+07:00')?.toISOString()).toBe(
      '2026-10-16T05:56:40.000Z',
    );
  });

  it('returns null for an empty or unparseable value', () => {
    expect(wallClockToUtc('')).toBeNull();
    expect(wallClockToUtc('   ')).toBeNull();
    expect(wallClockToUtc('not a time')).toBeNull();
  });
});
