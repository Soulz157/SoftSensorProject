/**
 * MODEL-SERVE-032. Rules for a model's PI OUTPUT tags. Pure, no I/O.
 *
 * Both tags are written to, so each must be a tag nothing else reads as
 * truth or as input. PI tag names are case-insensitive, so every comparison
 * is too: `lab.y` and `LAB.Y` are one point.
 */

export type OutputTagInput = {
  predictionTag: string | null;
  labTag: string | null;
  /** The model's lab target (`targetY`): the truth join READS it. */
  targetTag: string;
  /** Raw input tags (the schedule's base tags) and the model's feature columns. */
  inputTags: readonly string[];
};

const norm = (tag: string): string => tag.trim().toLowerCase();

/** PI point types a model's number can be stored in. Digital / String /
 *  Timestamp / Blob points cannot hold a prediction. */
const NUMERIC_POINT_TYPES = new Set([
  'float16',
  'float32',
  'float64',
  'int16',
  'int32',
]);

export function isNumericPointType(pointType: string | null | undefined) {
  return !!pointType && NUMERIC_POINT_TYPES.has(pointType.trim().toLowerCase());
}

/** Trim; empty or whitespace becomes null (= "not configured"). */
export function cleanTag(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * The first rule broken, as a sentence an operator can act on, or null.
 * Order matters only for which message wins; any one is enough to refuse.
 */
export function validateOutputTags(input: OutputTagInput): string | null {
  const slots: Array<[string, string | null]> = [
    ['Prediction output tag', input.predictionTag],
    ['Lab output tag', input.labTag],
  ];
  const target = norm(input.targetTag);
  const inputs = new Set(input.inputTags.map(norm));

  for (const [label, tag] of slots) {
    if (tag === null) continue;
    if (norm(tag) === target) {
      return `${label} cannot be the model's own lab target (${input.targetTag}): the truth comparison reads it.`;
    }
    if (inputs.has(norm(tag))) {
      return `${label} "${tag}" is one of the model's input tags; writing it would feed the model its own output.`;
    }
  }

  if (
    input.predictionTag !== null &&
    input.labTag !== null &&
    norm(input.predictionTag) === norm(input.labTag)
  ) {
    return 'Prediction and lab output tags must be different tags.';
  }
  return null;
}
