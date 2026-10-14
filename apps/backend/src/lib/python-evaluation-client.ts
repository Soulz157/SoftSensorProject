import { z } from 'zod';
import { postToPython, PYTHON_TIMEOUT } from './python-client';

/**
 * MODEL-SERVE-032. Typed wrappers over the Evaluation page's two python
 * reads. Same discipline as `python-preprocess-client.ts`: the response is
 * PARSED, not cast, and credentials ride the request body only.
 *
 * Every timestamp on this wire is a REAL UTC instant (ISO-8601 `Z`).
 */

const EvalFrameCellSchema = z.object({
  // null for a Bad cell: its stored 0.0 is a placeholder, never a reading.
  value: z.number().nullable(),
  status: z.enum(['Good', 'Bad', 'Questionable']),
});

const EvalFrameResponseSchema = z.object({
  rows: z.array(
    z.object({
      timestamp: z.string(),
      usable: z.boolean(),
      cells: z.record(z.string(), EvalFrameCellSchema),
    }),
  ),
  feature_columns: z.array(z.string()),
  display_tags: z.array(z.string()),
  unusable_rows: z.number().int().nonnegative(),
});

export type EvaluationFrameResult = z.infer<typeof EvalFrameResponseSchema>;

/**
 * One range's scoring input, returned inline. Persists nothing on the python
 * side. `pi` / `sql` is the block `InferenceWindowSchedulerService.
 * resolveSource` already builds.
 */
export async function evaluationFrame(input: {
  feature_spec_key: string;
  feature_columns: string[];
  display_tags: string[];
  window_start: string;
  window_end: string;
  interval: string;
  max_rows: number;
  pi?: Record<string, unknown>;
  sql?: Record<string, unknown>;
}): Promise<EvaluationFrameResult> {
  const res = await postToPython<unknown>(
    '/v1/preprocess/evaluation-frame',
    input,
    PYTHON_TIMEOUT.preprocess,
  );
  return EvalFrameResponseSchema.parse(res);
}

const PiRecordedResponseSchema = z.object({
  tag: z.string(),
  points: z.array(
    z.object({
      timestamp: z.string(),
      value: z.number().nullable(),
      good: z.boolean(),
    }),
  ),
  truncated: z.boolean(),
});

export type PiRecordedResult = z.infer<typeof PiRecordedResponseSchema>;

/** Raw recorded events of ONE PI tag. */
export async function piRecorded(input: {
  credentials: Record<string, unknown>;
  tag: string;
  start_time: string;
  end_time: string;
  max_count?: number;
}): Promise<PiRecordedResult> {
  const res = await postToPython<unknown>(
    '/v1/data-sources/pi/recorded',
    input,
    PYTHON_TIMEOUT.fetch,
  );
  return PiRecordedResponseSchema.parse(res);
}

const PiResolveResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  found: z.number().int().nonnegative(),
  tags: z.array(
    z.object({
      tagName: z.string(),
      exists: z.boolean(),
      // PI point type ('Float32', 'Digital', ...); absent when PI reported
      // none, which a caller must treat as "cannot confirm numeric".
      pointType: z.string().nullish(),
    }),
  ),
});

export type PiResolveResult = z.infer<typeof PiResolveResponseSchema>;

/** Existence + point type of PI tags by exact name. */
export async function piResolveTags(input: {
  credentials: Record<string, unknown>;
  tag_list: string[];
}): Promise<PiResolveResult> {
  const res = await postToPython<unknown>(
    '/v1/data-sources/pi/tags/resolve',
    input,
    PYTHON_TIMEOUT.metadata,
  );
  return PiResolveResponseSchema.parse(res);
}

const PiWriteResponseSchema = z.object({
  tag: z.string(),
  update_option: z.string(),
  results: z.array(
    z.object({
      timestamp: z.string(),
      ok: z.boolean(),
      error: z.string().nullish(),
    }),
  ),
});

export type PiWriteResult = z.infer<typeof PiWriteResponseSchema>;

/**
 * Replace / Remove recorded events on ONE PI tag. `ok: true` for a point means
 * PI did not object, not that it stored it -- the caller reads the range back.
 * A transport failure throws: part of the batch may already be stored.
 */
export async function piWrite(input: {
  credentials: Record<string, unknown>;
  tag: string;
  update_option: 'Replace' | 'Remove';
  points: Array<{ timestamp: string; value?: number }>;
}): Promise<PiWriteResult> {
  const res = await postToPython<unknown>(
    '/v1/data-sources/pi/write',
    input,
    PYTHON_TIMEOUT.fetch,
  );
  return PiWriteResponseSchema.parse(res);
}
