import {
  deriveMinRows,
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

describe('deriveMinRows (MODEL-SERVE-001-T14)', () => {
  it('reproduces env.INFERENCE_MIN_ROWS default exactly at a 1-minute interval, hourly cadence', () => {
    // The exact case env.INFERENCE_MIN_ROWS's own comment derives from:
    // "half an hourly window at the observed dataset's 1-minute interval
    // (60 rows/hour)" — floor(60 / 1 / 2) = 30.
    expect(deriveMinRows(60, '1m')).toBe(30);
  });

  it('derives a SMALLER floor for a 5-minute interval — the case this task exists to fix', () => {
    // 60-minute window / 5-minute interval = 12 rows in a complete window;
    // half of that is 6, not the global default's 30. A schedule at this
    // interval would read SKIPPED forever against the global constant.
    expect(deriveMinRows(60, '5m')).toBe(6);
  });

  it('derives from a non-hourly cadence too, not just the 60-minute default', () => {
    // 15-minute cadence / 1-minute interval = 15 rows; half, floored, is 7.
    expect(deriveMinRows(15, '1m')).toBe(7);
  });

  it('accepts seconds and hours, not only minutes', () => {
    // 60 / 0.5 = 120 rows; half is 60.
    expect(deriveMinRows(60, '30s')).toBe(60);
    // 60 / 60 = 1 row; half, floored, is 0 — clamped below.
    expect(deriveMinRows(60, '1h')).toBe(1);
  });

  it('clamps to a minimum of 1 — a floor of 0 would make SKIPPED unreachable', () => {
    // interval (10m) longer than the window itself (5m cadence): the raw
    // formula floors to 0, which must never mean "any row count passes".
    expect(deriveMinRows(5, '10m')).toBe(1);
  });

  it('tolerates surrounding whitespace, matching the client parser it mirrors', () => {
    expect(deriveMinRows(60, '  5m  ')).toBe(6);
  });

  it('returns null — never a guess — when intervalTime is absent (a non-PI source)', () => {
    // SQLConfig/InfluxConfig/etc. carry no `intervalTime` field at all
    // (store/model-pipeline.ts's own DataSourceConfig union) — the caller
    // must fall back to env.INFERENCE_MIN_ROWS, not receive a fabricated
    // per-schedule number derived from nothing.
    expect(deriveMinRows(60, undefined)).toBeNull();
  });

  it.each(['', 'bad', 'abc', '5x', '-5m', '0m', '5', 'm5'])(
    'returns null for an unparseable interval string: %j',
    (bad) => {
      expect(deriveMinRows(60, bad)).toBeNull();
    },
  );
});
