import {
  flatMinutes,
  nextTagObservation,
  type StoredTagObservation,
} from './tag-observation';

const NOW = new Date('2026-09-17T04:00:00.000Z');
const AT = '2026-09-17T03:55:00.000Z';

function stored(
  over: Partial<StoredTagObservation> = {},
): StoredTagObservation {
  return {
    lastValue: 42,
    lastChangedAt: new Date('2026-09-17T00:00:00.000Z'),
    // Earlier than the AT the tests read with, so the staleness guard does
    // not reject the reading — the guard has its own cases below.
    lastSeenAt: new Date('2026-09-17T00:00:00.000Z'),
    ...over,
  };
}

describe('nextTagObservation (MODEL-SERVE-009-T02)', () => {
  it('advances lastSeenAt but NOT lastChangedAt when the value is identical', () => {
    const out = nextTagObservation(
      { lastValue: 42, lastStatus: 0, observedAt: AT },
      stored(),
      NOW,
    );

    // Arrival and movement are different questions — collapsing them gives
    // back T29's pooled-range inference.
    expect(out!.lastSeenAt.toISOString()).toBe(AT);
    expect(out!.lastChangedAt.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('advances BOTH when the value differs', () => {
    const out = nextTagObservation(
      { lastValue: 43, lastStatus: 0, observedAt: AT },
      stored(),
      NOW,
    );

    expect(out!.lastSeenAt.toISOString()).toBe(AT);
    expect(out!.lastChangedAt.toISOString()).toBe(AT);
  });

  it('NEVER treats a Bad cell as movement, even when its number differs', () => {
    const out = nextTagObservation(
      // A Bad cell still carries a plausible number. Counting it as a change
      // would make a broken sensor read healthy BECAUSE it is broken.
      { lastValue: 999, lastStatus: 1, observedAt: AT },
      stored(),
      NOW,
    );

    expect(out!.lastChangedAt.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    // It still ARRIVED, so arrival is recorded and the raw value is kept.
    expect(out!.lastSeenAt.toISOString()).toBe(AT);
    expect(out!.lastValue).toBe(999);
    expect(out!.lastStatus).toBe(1);
  });

  it('does not treat a Questionable cell as movement either', () => {
    const out = nextTagObservation(
      { lastValue: 7, lastStatus: 2, observedAt: AT },
      stored(),
      NOW,
    );

    expect(out!.lastChangedAt.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('counts a FIRST sighting as a change rather than claiming flat-since-forever', () => {
    const out = nextTagObservation(
      { lastValue: 42, lastStatus: 0, observedAt: AT },
      null,
      NOW,
    );

    expect(out!.lastChangedAt.toISOString()).toBe(AT);
    expect(out!.lastSeenAt.toISOString()).toBe(AT);
  });

  it('seeds lastChangedAt when a stored row somehow has none, rather than writing null', () => {
    const out = nextTagObservation(
      { lastValue: 42, lastStatus: 0, observedAt: AT },
      stored({ lastChangedAt: null }),
      NOW,
    );

    expect(out!.lastChangedAt.toISOString()).toBe(AT);
  });

  it('falls back to the fetch clock on an unparseable connector timestamp, never an Invalid Date', () => {
    const out = nextTagObservation(
      { lastValue: 42, lastStatus: 0, observedAt: 'not-a-timestamp' },
      stored(),
      NOW,
    );

    expect(Number.isNaN(out!.lastSeenAt.getTime())).toBe(false);
    expect(out!.lastSeenAt.toISOString()).toBe(NOW.toISOString());
  });
});

describe('flatMinutes (MODEL-SERVE-009-T02)', () => {
  it('measures the flat run exactly, not rounded to the cadence', () => {
    // 2h50m — the case MODEL-SERVE-009 findings[3] says T29's three-window
    // pooled range reads as MOVING at a 60-minute cadence.
    expect(
      flatMinutes({
        lastSeenAt: new Date('2026-09-17T02:50:00.000Z'),
        lastChangedAt: new Date('2026-09-17T00:00:00.000Z'),
      }),
    ).toBe(170);
  });

  it('is NULL when either timestamp is missing — never 0', () => {
    // "We do not know" and "it changed just now" are different answers.
    expect(flatMinutes({ lastSeenAt: null, lastChangedAt: new Date() })).toBe(
      null,
    );
    expect(flatMinutes({ lastSeenAt: new Date(), lastChangedAt: null })).toBe(
      null,
    );
  });

  it('never returns a negative duration if the clocks disagree', () => {
    expect(
      flatMinutes({
        lastSeenAt: new Date('2026-09-17T00:00:00.000Z'),
        lastChangedAt: new Date('2026-09-17T01:00:00.000Z'),
      }),
    ).toBe(0);
  });
  // ── the out-of-order guard, found LIVE ───────────────────────────────────

  it('REFUSES a reading older than what is stored — a retry must not walk current state backwards', () => {
    // Exactly the live case: retrying a Sep-16 window after a Sep-17 fetch
    // had already written. Applying it inverted 5 real rows before this
    // guard existed (lastChangedAt AFTER lastSeenAt), which flatMinutes'
    // clamp would then hide as a confident 0.
    const out = nextTagObservation(
      { lastValue: 1, lastStatus: 0, observedAt: '2026-09-16T16:59:00.000Z' },
      stored({ lastSeenAt: new Date('2026-09-17T01:59:00.000Z') }),
      NOW,
    );

    expect(out).toBeNull();
  });

  it('refuses a reading at exactly the stored time — re-applying one fetch twice changes nothing', () => {
    const at = '2026-09-17T01:59:00.000Z';
    const out = nextTagObservation(
      { lastValue: 99, lastStatus: 0, observedAt: at },
      stored({ lastSeenAt: new Date(at) }),
      NOW,
    );

    expect(out).toBeNull();
  });

  it('accepts a NEWER reading, so the guard never blocks normal forward progress', () => {
    const out = nextTagObservation(
      { lastValue: 43, lastStatus: 0, observedAt: '2026-09-17T02:59:00.000Z' },
      stored({ lastSeenAt: new Date('2026-09-17T01:59:00.000Z') }),
      NOW,
    );

    expect(out).not.toBeNull();
    expect(out!.lastChangedAt.toISOString()).toBe('2026-09-17T02:59:00.000Z');
  });

  it('never produces a row whose lastChangedAt is after its lastSeenAt', () => {
    // The invariant the live defect broke, asserted directly.
    const out = nextTagObservation(
      { lastValue: 42, lastStatus: 0, observedAt: '2026-09-17T02:00:00.000Z' },
      stored({ lastSeenAt: new Date('2026-09-17T01:00:00.000Z') }),
      NOW,
    );

    expect(out!.lastChangedAt.getTime()).toBeLessThanOrEqual(
      out!.lastSeenAt.getTime(),
    );
  });
});
