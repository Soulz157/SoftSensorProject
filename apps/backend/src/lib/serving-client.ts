import { z } from 'zod';
import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';

/**
 * MODEL-SERVE-008-T02. The synchronous /predict client — the FIRST outbound
 * backend -> serving call in this system.
 *
 * Every call before this one ran the other way: apps/serving reaches the
 * backend for descriptors and prediction-log ingest, and `SERVING_API_TOKEN`
 * exists to VERIFY that inbound traffic (`ServingTokenGuard`). Nothing
 * authenticates in this direction because apps/serving's /predict carries no
 * auth of its own — it is an internal service on the compose network — so
 * this module deliberately sends no credential rather than inventing one.
 *
 * SEPARATE FROM `python-client.ts` ON PURPOSE: that module's `baseUrl()` and
 * error envelope are the FastAPI connector's, and a shared helper would make
 * a serving outage read as a data-connector outage. MODEL-SERVE-001-T18 is
 * the precedent — a failure that names the wrong system sends a reader to
 * audit a component that is working.
 */

const PredictResponseSchema = z.object({
  predictions: z.array(z.number()),
  modelId: z.string(),
  version: z.number().int(),
  // Computed on EVERY call by the serving route, not sampled: what the
  // caller sent versus what the model actually used. `unusedColumns` is the
  // silent projection in `rows_to_predictions` made visible, and the driver
  // logs it rather than discarding it — a tag-mapping drift shows up here
  // first, as columns quietly going unused while predictions keep returning.
  inputTagCheck: z.object({
    requiredColumns: z.array(z.string()),
    receivedColumns: z.array(z.string()),
    unusedColumns: z.array(z.string()),
  }),
});

export type PredictResult = z.infer<typeof PredictResponseSchema>;

function servingBaseUrl(): string {
  const url = env.SERVING_API_URL;
  if (!url) {
    throw new AppException({
      statusCode: 500,
      message: 'Serving service URL is not configured.',
      type: 'ERROR',
    });
  }
  return url.replace(/\/+$/, '');
}

/**
 * Score rows through the warm serving process.
 *
 * `rows` are PRE-SCALE feature values, the one request contract
 * MODEL-SERVE-002-T04 validates and MODEL-SERVE-003's batch path
 * deliberately shares (decisions.batch_input_is_pre_scale: "one request
 * contract for both the synchronous and batch paths, rather than two").
 * This driver adds a third caller, not a third shape.
 */
export async function predictRows(input: {
  modelId: string;
  rows: Array<Record<string, number>>;
  timeoutMs?: number;
}): Promise<PredictResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 15_000,
  );
  try {
    const res = await fetch(
      `${servingBaseUrl()}/v1/models/${encodeURIComponent(input.modelId)}/predict`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: input.rows }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      // FastAPI's own `detail`, verbatim where it exists — the discipline
      // `preflightReason` follows (MODEL-SERVE-006-T09): a guessed category
      // sends a reader to audit a config that is already correct.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        // Body was not JSON — the status alone is what we have, and is
        // better than claiming a cause we did not read.
      }
      throw new AppException({
        statusCode: 502,
        message: `Serving /predict failed: ${detail}`,
        type: 'ERROR',
      });
    }
    return PredictResponseSchema.parse(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}
