import {
  addTagCounts,
  classifyTag,
  emptyTagCounts,
  fillBuckets,
  overallBadPct,
  rangeWindow,
  rollupStorage,
  rollupTags,
  rowsByWorkspace,
  type ArtifactInput,
  type TagObservationInput,
} from './data-intake';

const NOW = new Date('2026-11-06T12:30:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function obs(over: Partial<TagObservationInput> = {}): TagObservationInput {
  return {
    modelId: 'm1',
    modelName: 'Model 1',
    tag: 'FI001.PV',
    lastValue: 1.5,
    lastStatus: 0,
    lastSeenAt: minutesAgo(5),
    lastChangedAt: minutesAgo(35),
    scheduleLive: true,
    cadenceMinutes: 60,
    ...over,
  };
}

describe('rangeWindow', () => {
  it.each([
    ['24h', 3_600_000],
    ['7d', 6 * 3_600_000],
    ['1m', 86_400_000],
    ['1y', 7 * 86_400_000],
  ] as const)('%s uses a fixed bucket size', (range, bucketMs) => {
    const w = rangeWindow(range, NOW);
    expect(w.bucketMs).toBe(bucketMs);
    expect(w.from.getTime() % bucketMs).toBe(0);
    expect(w.from.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});

describe('fillBuckets', () => {
  const window = rangeWindow('24h', NOW);
  const bucketSec = (i: number) =>
    (window.from.getTime() + i * window.bucketMs) / 1000;

  it('fills gaps with zero rows and null bad %', () => {
    const points = fillBuckets([], [], window);
    expect(points.length).toBeGreaterThan(20);
    expect(points.every((p) => p.scheduledRows === 0)).toBe(true);
    expect(points.every((p) => p.badCellPct === null)).toBe(true);
  });

  it('weights bad % by rows and sums workspaces in a bucket', () => {
    const points = fillBuckets(
      [
        {
          bucket: bucketSec(2),
          workspaceId: 'a',
          rows: 100,
          badWeighted: 1000,
        },
        { bucket: bucketSec(2), workspaceId: 'b', rows: 300, badWeighted: 0 },
      ],
      [{ bucket: bucketSec(2), workspaceId: 'a', rows: 7 }],
      window,
    );
    expect(points[2].scheduledRows).toBe(400);
    expect(points[2].predictRows).toBe(7);
    // (100*10 + 300*0) / 400 = 2.5
    expect(points[2].badCellPct).toBe(2.5);
  });

  it('keeps a predict-only bucket unknown for bad %', () => {
    const points = fillBuckets(
      [],
      [{ bucket: bucketSec(1), workspaceId: 'a', rows: 5 }],
      window,
    );
    expect(points[1].predictRows).toBe(5);
    expect(points[1].badCellPct).toBeNull();
  });
});

describe('rowsByWorkspace / overallBadPct', () => {
  const scheduled = [
    { bucket: 0, workspaceId: 'a', rows: 10, badWeighted: 100 },
    { bucket: 1, workspaceId: 'b', rows: 30, badWeighted: 0 },
  ];
  const predict = [{ bucket: 0, workspaceId: 'a', rows: 5 }];

  it('sums scheduled and predict rows per workspace', () => {
    const m = rowsByWorkspace(scheduled, predict);
    expect(m.get('a')).toBe(15);
    expect(m.get('b')).toBe(30);
  });

  it('returns null when there are no scheduled rows', () => {
    expect(overallBadPct([])).toBeNull();
    expect(overallBadPct(scheduled)).toBe(2.5);
  });
});

describe('classifyTag', () => {
  it('maps lastStatus 0/1/2 for a live, recent observation', () => {
    expect(classifyTag(obs({ lastStatus: 0 }), NOW)).toBe('good');
    expect(classifyTag(obs({ lastStatus: 1 }), NOW)).toBe('bad');
    expect(classifyTag(obs({ lastStatus: 2 }), NOW)).toBe('questionable');
  });

  it('is noReading when status is null or never seen', () => {
    expect(classifyTag(obs({ lastStatus: null }), NOW)).toBe('noReading');
    expect(classifyTag(obs({ lastSeenAt: null }), NOW)).toBe('noReading');
  });

  it('never calls a switched-off schedule Good', () => {
    expect(classifyTag(obs({ scheduleLive: false, lastStatus: 0 }), NOW)).toBe(
      'notLive',
    );
  });

  it('never calls an old observation Good (older than 3 cadences)', () => {
    expect(classifyTag(obs({ lastSeenAt: minutesAgo(181) }), NOW)).toBe(
      'notLive',
    );
    expect(classifyTag(obs({ lastSeenAt: minutesAgo(179) }), NOW)).toBe('good');
  });
});

describe('rollupTags', () => {
  it('counts distinct tags, not (model, tag) rows', () => {
    const { rows, counts } = rollupTags(
      [
        obs({ modelId: 'm1', tag: 'T1', lastStatus: 0 }),
        obs({ modelId: 'm2', modelName: 'Model 2', tag: 'T1', lastStatus: 0 }),
        obs({ tag: 'T2', lastStatus: 1 }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(3);
    expect(counts).toEqual({
      good: 1,
      bad: 1,
      questionable: 0,
      noReading: 0,
      notLive: 0,
    });
  });

  it('lets a live observation win over a not-live one for the same tag', () => {
    const { counts } = rollupTags(
      [
        obs({ modelId: 'm1', tag: 'T1', scheduleLive: false, lastStatus: 0 }),
        obs({ modelId: 'm2', tag: 'T1', lastStatus: 1 }),
      ],
      NOW,
    );
    expect(counts.bad).toBe(1);
    expect(counts.notLive).toBe(0);
    expect(counts.good).toBe(0);
  });

  it('uses the newest live observation when models disagree', () => {
    const { counts } = rollupTags(
      [
        obs({
          modelId: 'm1',
          tag: 'T1',
          lastStatus: 1,
          lastSeenAt: minutesAgo(30),
        }),
        obs({
          modelId: 'm2',
          tag: 'T1',
          lastStatus: 0,
          lastSeenAt: minutesAgo(2),
        }),
      ],
      NOW,
    );
    expect(counts.good).toBe(1);
    expect(counts.bad).toBe(0);
  });

  it('sorts Bad, Questionable, no reading, not live, then Good', () => {
    const { rows } = rollupTags(
      [
        obs({ tag: 'A', lastStatus: 0 }),
        obs({ tag: 'B', scheduleLive: false }),
        obs({ tag: 'C', lastStatus: null }),
        obs({ tag: 'D', lastStatus: 2 }),
        obs({ tag: 'E', lastStatus: 1 }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.quality)).toEqual([
      'bad',
      'questionable',
      'noReading',
      'notLive',
      'good',
    ]);
  });

  it('reports held minutes as a hint and null when unknown', () => {
    const { rows } = rollupTags(
      [obs({ tag: 'A' }), obs({ tag: 'B', lastChangedAt: null })],
      NOW,
    );
    expect(rows.find((r) => r.tag === 'A')?.heldMinutes).toBe(30);
    expect(rows.find((r) => r.tag === 'B')?.heldMinutes).toBeNull();
  });
});

describe('addTagCounts', () => {
  it('adds every bucket', () => {
    const a = { ...emptyTagCounts(), good: 2, bad: 1 };
    const b = { ...emptyTagCounts(), good: 1, notLive: 4 };
    expect(addTagCounts(a, b)).toEqual({
      good: 3,
      bad: 1,
      questionable: 0,
      noReading: 0,
      notLive: 4,
    });
  });
});

describe('rollupStorage', () => {
  const art = (over: Partial<ArtifactInput>): ArtifactInput => ({
    objectKey: 'k',
    sizeBytes: BigInt(100),
    datasetId: null,
    draftId: null,
    draftStatus: null,
    ...over,
  });

  it('splits saved, active-draft and awaiting-cleanup bytes', () => {
    const r = rollupStorage([
      art({ objectKey: 'a', datasetId: 'd1', sizeBytes: BigInt(1000) }),
      art({
        objectKey: 'b',
        draftId: 'x',
        draftStatus: 'ACTIVE',
        sizeBytes: BigInt(200),
      }),
      art({
        objectKey: 'c',
        draftId: 'y',
        draftStatus: 'SAVED',
        sizeBytes: BigInt(30),
      }),
      art({
        objectKey: 'd',
        draftId: 'z',
        draftStatus: 'ABANDONED',
        sizeBytes: BigInt(4),
      }),
    ]);
    expect(r.savedBytes).toBe(1000);
    expect(r.activeDraftBytes).toBe(200);
    expect(r.cleanupBytes).toBe(34);
    expect(r.totalBytes).toBe(1234);
    expect(r.byDataset.get('d1')).toBe(1000);
  });

  it('counts a shared objectKey once, as saved', () => {
    const r = rollupStorage([
      art({
        objectKey: 'drafts/x/final',
        draftId: 'x',
        draftStatus: 'SAVED',
        sizeBytes: BigInt(500),
      }),
      art({
        objectKey: 'drafts/x/final',
        datasetId: 'd1',
        sizeBytes: BigInt(500),
      }),
    ]);
    expect(r.totalBytes).toBe(500);
    expect(r.savedBytes).toBe(500);
    expect(r.cleanupBytes).toBe(0);
  });

  it('is empty for no artifacts', () => {
    const r = rollupStorage([]);
    expect(r.totalBytes).toBe(0);
    expect(r.byDataset.size).toBe(0);
  });
});
