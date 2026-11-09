import {
  deriveStatus,
  FUTURE_SLACK_MS,
  itemOutcome,
  matchNearest,
  normalizePoints,
  sameValue,
} from './pi-write-back';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

describe('normalizePoints', () => {
  it('sorts by time and returns ISO ms', () => {
    const r = normalizePoints(
      [
        { timestamp: '2026-10-14T02:00:00Z', value: 2 },
        { timestamp: '2026-10-14T01:00:00Z', value: 1 },
      ],
      NOW,
    );
    expect(r.error).toBeNull();
    expect(r.points.map((p) => [p.iso, p.value])).toEqual([
      ['2026-10-14T01:00:00.000Z', 1],
      ['2026-10-14T02:00:00.000Z', 2],
    ]);
  });

  it('refuses two points on one instant, even spelled differently', () => {
    const r = normalizePoints(
      [
        { timestamp: '2026-10-14T01:00:00Z', value: 1 },
        { timestamp: '2026-10-14T01:00:00.000Z', value: 2 },
      ],
      NOW,
    );
    expect(r.error).toMatch(/share the timestamp 2026-10-14T01:00:00.000Z/);
    expect(r.points).toEqual([]);
  });

  it('refuses a non-finite value and an unreadable timestamp', () => {
    expect(
      normalizePoints([{ timestamp: '2026-10-14T01:00:00Z', value: NaN }], NOW)
        .error,
    ).toMatch(/non-finite/);
    expect(
      normalizePoints([{ timestamp: 'nope', value: 1 }], NOW).error,
    ).toMatch(/Unreadable/);
  });

  it('refuses the future beyond the clock-skew slack, accepts inside it', () => {
    const inside = new Date(NOW + FUTURE_SLACK_MS - 1000).toISOString();
    const outside = new Date(NOW + FUTURE_SLACK_MS + 1000).toISOString();
    expect(
      normalizePoints([{ timestamp: inside, value: 1 }], NOW).error,
    ).toBeNull();
    expect(
      normalizePoints([{ timestamp: outside, value: 1 }], NOW).error,
    ).toMatch(/in the future/);
  });
});

describe('matchNearest', () => {
  const ev = (iso: string, value: number | null) => ({
    at: Date.parse(iso),
    value,
  });
  const t = (iso: string) => Date.parse(iso);

  it('matches within the tolerance and returns null outside it', () => {
    const events = [ev('2026-10-14T01:00:00.400Z', 5)];
    expect(matchNearest([t('2026-10-14T01:00:00Z')], events)).toEqual([
      events[0],
    ]);
    expect(matchNearest([t('2026-10-14T01:00:02Z')], events)).toEqual([null]);
  });

  it('picks the NEAREST of two candidates, not the first', () => {
    const near = ev('2026-10-14T01:00:00.100Z', 1);
    const far = ev('2026-10-14T00:59:59.500Z', 2);
    expect(matchNearest([t('2026-10-14T01:00:00Z')], [far, near])).toEqual([
      near,
    ]);
  });

  it('does not require sorted events and handles empty', () => {
    const a = ev('2026-10-14T03:00:00Z', 3);
    const b = ev('2026-10-14T01:00:00Z', 1);
    expect(
      matchNearest(
        [t('2026-10-14T01:00:00Z'), t('2026-10-14T03:00:00Z')],
        [a, b],
      ),
    ).toEqual([b, a]);
    expect(matchNearest([t('2026-10-14T01:00:00Z')], [])).toEqual([null]);
  });

  it('keeps a non-numeric event (value null) so the caller can refuse it', () => {
    const state = ev('2026-10-14T01:00:00Z', null);
    expect(
      matchNearest([t('2026-10-14T01:00:00Z')], [state])[0]?.value,
    ).toBeNull();
  });
});

describe('sameValue', () => {
  it('tolerates float32 rounding, not a real difference', () => {
    expect(sameValue(12.345678, Math.fround(12.345678))).toBe(true);
    expect(sameValue(100, 100.001)).toBe(false);
    expect(sameValue(0, 1e-9)).toBe(true);
    expect(sameValue(0, 0.001)).toBe(false);
  });
});

describe('deriveStatus', () => {
  it('SUCCEEDED only when every point is ok', () => {
    expect(deriveStatus(3, 3)).toBe('SUCCEEDED');
    expect(deriveStatus(2, 3)).toBe('PARTIAL');
    expect(deriveStatus(0, 3)).toBe('FAILED');
    expect(deriveStatus(0, 0)).toBe('FAILED');
  });
});

describe('itemOutcome', () => {
  it('ok when PI accepted and stored what was sent', () => {
    expect(
      itemOutcome({ writerOk: true, writerError: null, sent: 5, stored: 5 }),
    ).toEqual({ ok: true, error: null });
  });

  it("surfaces PI's own rejection", () => {
    expect(
      itemOutcome({
        writerOk: false,
        writerError: 'Value out of range',
        sent: 5,
        stored: null,
      }),
    ).toEqual({ ok: false, error: 'Value out of range' });
  });

  it('an accepted write with nothing stored is a failure, not a success', () => {
    const r = itemOutcome({
      writerOk: true,
      writerError: null,
      sent: 5,
      stored: null,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no value is stored/);
  });

  it('a different stored value is a failure that says what PI kept', () => {
    const r = itemOutcome({
      writerOk: true,
      writerError: null,
      sent: 5,
      stored: 4.5,
    });
    expect(r).toEqual({ ok: false, error: 'PI stored 4.5 instead of 5.' });
  });
});

import {
  currentState,
  planRollback,
  restoredOutcome,
  type CurrentState,
  type RecordedBatchPoint,
} from './pi-write-back';

const none: CurrentState = { kind: 'none' };
const val = (value: number): CurrentState => ({ kind: 'value', value });
const system: CurrentState = { kind: 'system' };
const pt = (over: Partial<RecordedBatchPoint> = {}): RecordedBatchPoint => ({
  at: 1,
  beforeExisted: true,
  beforeValue: 7,
  afterValue: 10,
  ...over,
});

describe('currentState', () => {
  it('maps a matched event, a missing one and a non-numeric one', () => {
    expect(currentState(null)).toEqual(none);
    expect(currentState({ at: 1, value: 3 })).toEqual(val(3));
    expect(currentState({ at: 1, value: null })).toEqual(system);
  });
});

describe('planRollback', () => {
  it('REPLACE: the point existed before, PI still holds what we wrote', () => {
    const [p] = planRollback([pt()], [val(10)]);
    expect(p).toMatchObject({
      action: 'REPLACE',
      restoreTo: 7,
      drifted: false,
    });
  });

  it('REMOVE: the point did not exist before and we created it', () => {
    const [p] = planRollback(
      [pt({ beforeExisted: false, beforeValue: null })],
      [val(10)],
    );
    expect(p).toMatchObject({
      action: 'REMOVE',
      restoreTo: null,
      drifted: false,
    });
  });

  it('SKIP: already in the original state (a prior partial rollback, or never landed)', () => {
    expect(planRollback([pt()], [val(7)])[0]).toMatchObject({
      action: 'SKIP',
      // Our own earlier restore must not read as someone else's change.
      drifted: false,
    });
    expect(
      planRollback(
        [pt({ beforeExisted: false, beforeValue: null, afterValue: null })],
        [none],
      )[0],
    ).toMatchObject({ action: 'SKIP', drifted: false });
  });

  it('flags DRIFT when someone changed the value after our write, and still plans the restore', () => {
    const [p] = planRollback([pt()], [val(99)]);
    expect(p).toMatchObject({
      drifted: true,
      action: 'REPLACE',
      restoreTo: 7,
      expected: 10,
    });
    expect(p.actual).toEqual(val(99));
  });

  it('flags drift when the value we wrote has gone missing', () => {
    expect(planRollback([pt()], [none])[0]).toMatchObject({
      drifted: true,
      action: 'REPLACE',
    });
  });

  it('flags drift when a value appeared where we recorded nothing', () => {
    const [p] = planRollback(
      [pt({ beforeExisted: false, beforeValue: null, afterValue: null })],
      [val(5)],
    );
    expect(p).toMatchObject({ drifted: true, action: 'REMOVE' });
  });

  it('never touches a non-numeric system state, drift or not', () => {
    const [p] = planRollback([pt()], [system]);
    expect(p).toMatchObject({ action: 'BLOCKED', drifted: true });
  });

  it('treats float32 round-off as unchanged, not drift', () => {
    const [p] = planRollback(
      [pt({ afterValue: 12.345678 })],
      [val(Math.fround(12.345678))],
    );
    expect(p.drifted).toBe(false);
  });

  it('a missing current entry reads as nothing there', () => {
    expect(planRollback([pt()], [])[0].actual).toEqual(none);
  });
});

describe('restoredOutcome', () => {
  const existed = { beforeExisted: true, beforeValue: 7 };
  const created = { beforeExisted: false, beforeValue: null };

  it('ok when a replaced point is back to its original value', () => {
    expect(restoredOutcome(existed, 'REPLACE', true, null, val(7))).toEqual({
      ok: true,
      error: null,
    });
  });

  it('ok when a created point is gone', () => {
    expect(restoredOutcome(created, 'REMOVE', true, null, none).ok).toBe(true);
  });

  it('a skipped point already in its original state is ok', () => {
    expect(restoredOutcome(existed, 'SKIP', true, null, val(7)).ok).toBe(true);
  });

  it('fails when PI accepted the restore but still holds another value', () => {
    expect(restoredOutcome(existed, 'REPLACE', true, null, val(10))).toEqual({
      ok: false,
      error: 'PI holds 10 instead of the original 7.',
    });
  });

  it('fails when a removed point is still there', () => {
    expect(
      restoredOutcome(created, 'REMOVE', true, null, val(10)).error,
    ).toMatch(/still present/);
  });

  it("carries PI's own rejection", () => {
    expect(
      restoredOutcome(existed, 'REPLACE', false, 'denied', val(10)).error,
    ).toBe('denied');
  });

  it('a blocked system state is a failure with its own reason', () => {
    expect(
      restoredOutcome(existed, 'BLOCKED', true, null, system),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/non-numeric system state/) as string,
    });
  });
});
