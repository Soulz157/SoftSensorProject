import {
  cleanTag,
  isNumericPointType,
  validateOutputTags,
  type OutputTagInput,
} from './write-back-config';

const base: OutputTagInput = {
  predictionTag: 'OUT.PRED',
  labTag: 'OUT.LAB',
  targetTag: 'LAB.Y',
  inputTags: ['TI202.PV', 'FI100.PV', 'LAB.Y'],
};

describe('validateOutputTags', () => {
  it('accepts two distinct tags nothing else uses', () => {
    expect(validateOutputTags(base)).toBeNull();
  });

  it('accepts either tag unset (null = not configured)', () => {
    expect(validateOutputTags({ ...base, labTag: null })).toBeNull();
    expect(
      validateOutputTags({ ...base, predictionTag: null, labTag: null }),
    ).toBeNull();
  });

  it("refuses the model's own lab target, in either slot", () => {
    expect(validateOutputTags({ ...base, predictionTag: 'LAB.Y' })).toMatch(
      /lab target/,
    );
    expect(validateOutputTags({ ...base, labTag: 'LAB.Y' })).toMatch(
      /Lab output tag cannot/,
    );
  });

  it('is case-insensitive, as PI tag names are', () => {
    expect(validateOutputTags({ ...base, predictionTag: 'lab.y' })).toMatch(
      /lab target/,
    );
    expect(validateOutputTags({ ...base, labTag: 'ti202.pv' })).toMatch(
      /input tags/,
    );
  });

  it('refuses an input tag so the model is never fed its own output', () => {
    const msg = validateOutputTags({ ...base, predictionTag: 'TI202.PV' });
    expect(msg).toMatch(/input tags/);
    expect(msg).toMatch(/TI202\.PV/);
  });

  it('refuses the same tag for both outputs', () => {
    expect(validateOutputTags({ ...base, labTag: 'out.pred' })).toMatch(
      /different tags/,
    );
  });

  it('ignores surrounding whitespace in the comparison', () => {
    expect(validateOutputTags({ ...base, predictionTag: ' LAB.Y ' })).toMatch(
      /lab target/,
    );
  });
});

describe('isNumericPointType', () => {
  it.each(['Float32', 'float64', 'Float16', 'Int16', 'Int32', ' Float32 '])(
    'accepts %s',
    (t) => expect(isNumericPointType(t)).toBe(true),
  );
  it.each(['Digital', 'String', 'Timestamp', 'Blob', '', null, undefined])(
    'refuses %s',
    (t) => expect(isNumericPointType(t)).toBe(false),
  );
});

describe('cleanTag', () => {
  it('trims and turns blank into null', () => {
    expect(cleanTag('  OUT.PRED ')).toBe('OUT.PRED');
    expect(cleanTag('   ')).toBeNull();
    expect(cleanTag('')).toBeNull();
    expect(cleanTag(null)).toBeNull();
    expect(cleanTag(undefined)).toBeNull();
  });
});
