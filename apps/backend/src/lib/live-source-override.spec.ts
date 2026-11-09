import {
  buildOverrideFetchConfig,
  checkColumnTagMap,
  readLiveSourceOverride,
} from './live-source-override';

describe('checkColumnTagMap (MODEL-SERVE-037-T02)', () => {
  it('accepts a full map, trims tags, and keeps an optional target', () => {
    const res = checkColumnTagMap(['a', 'b'], ['y'], {
      a: ' TAG_A.PV ',
      b: 'TAG_B.PV',
      y: 'LAB.Y',
    });
    expect(res).toEqual({
      ok: true,
      columnTagMap: { a: 'TAG_A.PV', b: 'TAG_B.PV', y: 'LAB.Y' },
      tags: ['TAG_A.PV', 'TAG_B.PV', 'LAB.Y'],
    });
  });

  it('allows the optional target to stay unmapped', () => {
    const res = checkColumnTagMap(['a'], ['y'], { a: 'A', y: '  ' });
    expect(res).toEqual({ ok: true, columnTagMap: { a: 'A' }, tags: ['A'] });
  });

  it('names every unmapped input, blank counting as unmapped', () => {
    const res = checkColumnTagMap(['a', 'b', 'c'], [], { a: 'A', b: '' });
    expect(res).toEqual({
      ok: false,
      reason: 'Map every model input to a PI tag. Unmapped: b, c.',
    });
  });

  it('refuses a column the model does not read', () => {
    const res = checkColumnTagMap(['a'], [], { a: 'A', z: 'Z' });
    expect(res).toEqual({
      ok: false,
      reason: 'Not an input of this model: z.',
    });
  });

  it('refuses one tag mapped to two columns', () => {
    const res = checkColumnTagMap(['a', 'b'], [], { a: 'T', b: 'T' });
    expect(res).toEqual({
      ok: false,
      reason: 'Each PI tag can feed only one column. T is mapped to a, b.',
    });
  });
});

describe('override fetchConfig round trip', () => {
  it('stores the mapped tags as baseTags and reads the override back', () => {
    const fc = buildOverrideFetchConfig(
      { intervalTime: '5m', calcType: 'Average', calcBasis: 'TimeWeighted' },
      { a: 'TAG_A.PV' },
    );
    expect(fc.baseTags).toEqual(['TAG_A.PV']);
    expect(readLiveSourceOverride(fc)).toEqual({
      intervalTime: '5m',
      calcType: 'Average',
      calcBasis: 'TimeWeighted',
      columnTagMap: { a: 'TAG_A.PV' },
    });
  });

  it('reads an ordinary dataset binding as no override', () => {
    expect(
      readLiveSourceOverride({ type: 'pi', intervalTime: '1m', baseTags: [] }),
    ).toBeNull();
    expect(readLiveSourceOverride(null)).toBeNull();
  });
});
