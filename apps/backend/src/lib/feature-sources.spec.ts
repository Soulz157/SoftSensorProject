import {
  directSources,
  resolveFeatureSources,
  type FeatureSpecEntry,
} from './feature-sources';

describe('directSources', () => {
  it("reads a formula's sources from config.vars, not its expression text", () => {
    expect(
      directSources({
        name: 'ratio_x',
        kind: 'formula',
        config: { expr: 'c0 / c1', vars: { c0: 'FI001.PV', c1: 'FI003.PV' } },
      }),
    ).toEqual(['FI001.PV', 'FI003.PV']);
  });

  it('reads the single-tag kinds from config.tag', () => {
    for (const kind of ['lag', 'rolling', 'delta', 'log']) {
      expect(directSources({ kind, config: { tag: 'TI-101' } })).toEqual([
        'TI-101',
      ]);
    }
  });

  it('reads the multi-tag kinds from config.tags', () => {
    expect(
      directSources({ kind: 'arith', config: { op: 'add', tags: ['A', 'B'] } }),
    ).toEqual(['A', 'B']);
    expect(
      directSources({ kind: 'ratio', config: { tags: ['A', 'B'] } }),
    ).toEqual(['A', 'B']);
  });

  it('returns [] — not null — for datetime, which reads the timestamp and no tag', () => {
    // The distinction matters: [] means "recognised, depends on no tag, so
    // no tag's quality can spoil it"; null means "unrecognised, cannot say".
    expect(
      directSources({ kind: 'datetime', config: { part: 'hour' } }),
    ).toEqual([]);
  });

  it('returns null for an unrecognised kind rather than guessing', () => {
    expect(directSources({ kind: 'someFutureKind', config: {} })).toBeNull();
  });

  it('returns null when a recognised kind is missing its own config key', () => {
    expect(directSources({ kind: 'lag', config: {} })).toBeNull();
    expect(
      directSources({ kind: 'formula', config: { expr: 'c0' } }),
    ).toBeNull();
  });
});

describe('resolveFeatureSources', () => {
  it('resolves a base-tag source to itself', () => {
    const { baseSourcesByColumn } = resolveFeatureSources([
      { name: 'TI-101__lag3', kind: 'lag', config: { tag: 'TI-101', k: 3 } },
    ]);
    expect(baseSourcesByColumn['TI-101__lag3']).toEqual(['TI-101']);
  });

  it('resolves TRANSITIVELY when a formula reads a column that is itself derived', () => {
    // The case that makes a direct-read check wrong: the formula's own
    // `vars` names `TI-101__lag3`, which PI has never heard of — only
    // `TI-101` is a real tag whose status can be read.
    const features: FeatureSpecEntry[] = [
      { name: 'TI-101__lag3', kind: 'lag', config: { tag: 'TI-101', k: 3 } },
      {
        name: 'chained',
        kind: 'formula',
        config: { expr: 'c0 * 2', vars: { c0: 'TI-101__lag3' } },
      },
    ];
    const { baseSourcesByColumn } = resolveFeatureSources(features);
    expect(baseSourcesByColumn['chained']).toEqual(['TI-101']);
  });

  it('unions base tags across a multi-source chain, de-duplicated', () => {
    const features: FeatureSpecEntry[] = [
      { name: 'a_lag', kind: 'lag', config: { tag: 'A', k: 1 } },
      { name: 'b_roll', kind: 'rolling', config: { tag: 'B', window: 5 } },
      {
        name: 'combined',
        kind: 'formula',
        // Reads one derived column, one base tag, and A again through the lag.
        config: {
          expr: 'c0+c1+c2',
          vars: { c0: 'a_lag', c1: 'b_roll', c2: 'A' },
        },
      },
    ];
    const { baseSourcesByColumn } = resolveFeatureSources(features);
    expect(baseSourcesByColumn['combined']).toEqual(['A', 'B']);
  });

  it('marks an unrecognised kind unresolved, and anything downstream of it too', () => {
    const features: FeatureSpecEntry[] = [
      { name: 'mystery', kind: 'someFutureKind', config: {} },
      {
        name: 'downstream',
        kind: 'formula',
        config: { expr: 'c0', vars: { c0: 'mystery' } },
      },
    ];
    const { baseSourcesByColumn, unresolved } = resolveFeatureSources(features);
    expect(unresolved.has('mystery')).toBe(true);
    // Critical: the dependent must NOT silently resolve to a base tag set
    // that omits its unknowable half.
    expect(unresolved.has('downstream')).toBe(true);
    expect(baseSourcesByColumn['downstream']).toBeUndefined();
  });

  it('keeps a datetime feature resolved with an empty source list', () => {
    const { baseSourcesByColumn, unresolved } = resolveFeatureSources([
      { name: 'hour', kind: 'datetime', config: { part: 'hour' } },
    ]);
    expect(baseSourcesByColumn['hour']).toEqual([]);
    expect(unresolved.has('hour')).toBe(false);
  });

  it('refuses a cyclic spec instead of recursing forever', () => {
    const features: FeatureSpecEntry[] = [
      { name: 'x', kind: 'formula', config: { expr: 'c0', vars: { c0: 'y' } } },
      { name: 'y', kind: 'formula', config: { expr: 'c0', vars: { c0: 'x' } } },
    ];
    const { unresolved } = resolveFeatureSources(features);
    expect(unresolved.has('x')).toBe(true);
    expect(unresolved.has('y')).toBe(true);
  });
});
