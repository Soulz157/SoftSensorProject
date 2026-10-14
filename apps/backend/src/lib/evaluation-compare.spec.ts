import {
  assemblePoints,
  chunk,
  expectedRows,
  featureRow,
  intervalToMs,
  labEvents,
  skipReason,
  xSeries,
  type FrameRow,
} from './evaluation-compare';

const good = (value: number) => ({ value, status: 'Good' as const });
const bad = () => ({ value: null, status: 'Bad' as const });

function row(t: string, cells: FrameRow['cells'], usable = true): FrameRow {
  return { timestamp: t, usable, cells };
}

describe('intervalToMs / expectedRows', () => {
  it('parses the cadence forms the schedule stores', () => {
    expect(intervalToMs('1m')).toBe(60_000);
    expect(intervalToMs('30s')).toBe(30_000);
    expect(intervalToMs('2h')).toBe(7_200_000);
    expect(intervalToMs('1d')).toBe(86_400_000);
  });

  it('returns null rather than guessing for anything else', () => {
    expect(intervalToMs('')).toBeNull();
    expect(intervalToMs('1 month')).toBeNull();
    expect(intervalToMs('0m')).toBeNull();
    expect(intervalToMs('m')).toBeNull();
  });

  it('counts rows of a half-open range', () => {
    const from = new Date('2026-10-14T00:00:00Z');
    expect(expectedRows(from, new Date('2026-10-14T01:00:00Z'), '1m')).toBe(60);
    expect(
      expectedRows(from, new Date('2026-10-14T01:00:00Z'), 'x'),
    ).toBeNull();
  });
});

describe('skipReason', () => {
  it('names the non-Good feature columns, not the display tags', () => {
    const r = row('t', { A: bad(), B: good(1), X: bad() }, false);
    expect(skipReason(r, ['A', 'B'])).toBe(
      'Input not usable — A did not report Good values.',
    );
  });

  it('caps the list at three', () => {
    const cells = Object.fromEntries(
      ['A', 'B', 'C', 'D', 'E'].map((c) => [c, bad()]),
    );
    expect(skipReason(row('t', cells, false), ['A', 'B', 'C', 'D', 'E'])).toBe(
      'Input not usable — A, B, C +2 more did not report Good values.',
    );
  });

  it('treats a missing column as not Good', () => {
    expect(skipReason(row('t', {}, false), ['A'])).toContain('A');
  });
});

describe('featureRow', () => {
  it('builds the pre-scale row in the column order given', () => {
    expect(
      featureRow(row('t', { B: good(2), A: good(1) }), ['A', 'B']),
    ).toEqual({
      A: 1,
      B: 2,
    });
  });

  it('refuses a usable row that has no value rather than sending 0', () => {
    expect(() => featureRow(row('t', { A: bad() }), ['A'])).toThrow(/no value/);
  });
});

describe('assemblePoints', () => {
  const rows = [
    row('t1', { A: good(1) }),
    row('t2', { A: bad() }, false),
    row('t3', { A: good(3) }),
  ];

  it('puts each prediction on its own usable row and leaves gaps null', () => {
    const pts = assemblePoints(rows, ['A'], [10, 30]);
    expect(pts.map((p) => [p.t, p.predicted])).toEqual([
      ['t1', 10],
      ['t2', null],
      ['t3', 30],
    ]);
    expect(pts[1].skippedReason).toMatch(/A did not report Good/);
    expect(pts[0].skippedReason).toBeNull();
  });

  it('throws on a count mismatch instead of mis-pairing timestamps', () => {
    expect(() => assemblePoints(rows, ['A'], [10])).toThrow(
      /1 predictions for 2 usable/,
    );
  });

  it('does not chart a non-finite model output as a prediction', () => {
    const pts = assemblePoints(
      [row('t1', { A: good(1) })],
      ['A'],
      [Number.NaN],
    );
    expect(pts[0].predicted).toBeNull();
    expect(pts[0].skippedReason).toMatch(/non-finite/);
  });
});

describe('xSeries', () => {
  it('is aligned to the row grid with null for Bad / absent cells', () => {
    const rows = [
      row('t1', { X: good(5) }),
      row('t2', { X: bad() }),
      row('t3', {}),
    ];
    expect(xSeries(rows, ['X', 'Y'])).toEqual({
      X: [5, null, null],
      Y: [null, null, null],
    });
  });
});

describe('labEvents', () => {
  const from = new Date('2026-10-14T00:00:00Z');
  const to = new Date('2026-10-14T12:00:00Z');

  it('keeps only Good numeric events inside [from, to)', () => {
    const out = labEvents(
      [
        { timestamp: '2026-10-13T23:59:00Z', value: 1, good: true }, // before
        { timestamp: '2026-10-14T00:00:00Z', value: 2, good: true }, // == from, in
        { timestamp: '2026-10-14T06:00:00Z', value: 3, good: false }, // Bad
        { timestamp: '2026-10-14T07:00:00Z', value: null, good: true }, // not numeric
        { timestamp: '2026-10-14T08:00:00Z', value: 4, good: true },
        { timestamp: '2026-10-14T12:00:00Z', value: 5, good: true }, // == to, out
      ],
      from,
      to,
    );
    expect(out).toEqual([
      { t: '2026-10-14T00:00:00Z', value: 2 },
      { t: '2026-10-14T08:00:00Z', value: 4 },
    ]);
  });

  it('drops an unparseable timestamp', () => {
    expect(
      labEvents([{ timestamp: 'nope', value: 1, good: true }], from, to),
    ).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits in order with a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
