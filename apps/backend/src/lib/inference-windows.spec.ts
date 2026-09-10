import {
  formatDtHour,
  windowEndFor,
  windowStartsBetween,
} from './inference-windows';

describe('windowStartsBetween (MODEL-SERVE-006-T01/T02/T11)', () => {
  it('returns aligned starts inside a half-open range at 60-minute cadence', () => {
    const from = new Date('2026-09-10T06:30:00.000Z');
    const to = new Date('2026-09-10T09:00:00.000Z');
    const starts = windowStartsBetween(from, to, 60);
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-09-10T07:00:00.000Z',
      '2026-09-10T08:00:00.000Z',
    ]);
  });

  it('excludes a start exactly at `to` — the half-open convention', () => {
    const from = new Date('2026-09-10T07:00:00.000Z');
    const to = new Date('2026-09-10T09:00:00.000Z');
    const starts = windowStartsBetween(from, to, 60);
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-09-10T07:00:00.000Z',
      '2026-09-10T08:00:00.000Z',
    ]);
  });

  it('includes a start exactly at `from` when already aligned', () => {
    const from = new Date('2026-09-10T07:00:00.000Z');
    const to = new Date('2026-09-10T08:00:00.001Z');
    const starts = windowStartsBetween(from, to, 60);
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-09-10T07:00:00.000Z',
      '2026-09-10T08:00:00.000Z',
    ]);
  });

  it('an unaligned `from` on a backfill request snaps to the same starts the tick would produce for the identical wall-clock range', () => {
    // D7's own invariant: the tick always calls this with epoch-aligned
    // bounds, but a human-entered backfill range will not be. Both must
    // agree on which windowStart values exist, or skipDuplicates cannot
    // prevent a duplicate row.
    const tickFrom = new Date('2026-09-10T07:00:00.000Z');
    const backfillFrom = new Date('2026-09-10T07:14:59.000Z'); // mid-window
    const to = new Date('2026-09-10T09:00:00.000Z');

    const fromTick = windowStartsBetween(tickFrom, to, 60);
    const fromBackfill = windowStartsBetween(backfillFrom, to, 60);
    // The backfill's unaligned `from` falls inside the 07:00 window, so
    // it must NOT re-mint 07:00 — only 08:00 is still ahead of it.
    expect(fromBackfill).toEqual([new Date('2026-09-10T08:00:00.000Z')]);
    expect(fromTick).toEqual([
      new Date('2026-09-10T07:00:00.000Z'),
      new Date('2026-09-10T08:00:00.000Z'),
    ]);
  });

  it('returns [] when `to` <= `from`', () => {
    const from = new Date('2026-09-10T09:00:00.000Z');
    const to = new Date('2026-09-10T07:00:00.000Z');
    expect(windowStartsBetween(from, to, 60)).toEqual([]);
  });

  it('works at a non-hour cadence (15 minutes) without drifting off :00/:15/:30/:45', () => {
    const from = new Date('2026-09-10T07:00:00.000Z');
    const to = new Date('2026-09-10T08:00:00.000Z');
    const starts = windowStartsBetween(from, to, 15);
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-09-10T07:00:00.000Z',
      '2026-09-10T07:15:00.000Z',
      '2026-09-10T07:30:00.000Z',
      '2026-09-10T07:45:00.000Z',
    ]);
  });

  it('rejects a non-positive cadence rather than looping forever', () => {
    expect(() => windowStartsBetween(new Date(0), new Date(1_000), 0)).toThrow(
      /cadenceMinutes must be positive/,
    );
    expect(() => windowStartsBetween(new Date(0), new Date(1_000), -5)).toThrow(
      /cadenceMinutes must be positive/,
    );
  });
});

describe('windowEndFor', () => {
  it('is exactly one cadence after windowStart', () => {
    const start = new Date('2026-09-10T08:00:00.000Z');
    expect(windowEndFor(start, 60).toISOString()).toBe(
      '2026-09-10T09:00:00.000Z',
    );
  });
});

describe('formatDtHour (MODEL-SERVE-006-T06)', () => {
  it('formats a UTC instant as zero-padded dt/hour', () => {
    expect(formatDtHour(new Date('2026-09-10T08:00:00.000Z'))).toEqual({
      dt: '2026-09-10',
      hour: '08',
    });
  });

  it('zero-pads a single-digit hour and rolls the date at midnight UTC', () => {
    expect(formatDtHour(new Date('2026-01-01T00:00:00.000Z'))).toEqual({
      dt: '2026-01-01',
      hour: '00',
    });
  });
});
