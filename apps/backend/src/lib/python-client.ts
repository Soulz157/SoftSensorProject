import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';

/**
 * Server-to-server client for the FastAPI data-connector service (apps/python).
 *
 * All Data Source traffic to PI / SQL / REST connectors flows through here so
 * decrypted credentials leave NestJS only over this hop and never touch the
 * browser. Request bodies carry secrets — this module NEVER logs the body,
 * headers, URL query, or upstream error payloads.
 *
 * Errors are surfaced as AppException so callers (data-source services) get the
 * house error envelope. Callers are responsible for sanitising the message
 * further before returning it to the client (see F6).
 */

/** Default upstream timeouts (ms). Fetches over a time range can be slow. */
export const PYTHON_TIMEOUT = {
  test: 15_000,
  metadata: 30_000,
  fetch: 120_000,
  /**
   * Preprocessing writes whole artifacts, so it is the slowest hop by an order
   * of magnitude. The job runner makes one call per OPERATION rather than one
   * per pipeline precisely so no single call approaches this ceiling.
   */
  preprocess: 300_000,
} as const;

interface FastApiError {
  detail?: string;
}

function baseUrl(): string {
  const url = env.PYTHON_API_URL;
  if (!url) {
    throw new AppException({
      statusCode: 500,
      message: 'Data connector service URL is not configured.',
      type: 'ERROR',
    });
  }
  return url.replace(/\/+$/, '');
}

/**
 * POST a JSON body to the FastAPI connector and return the parsed response.
 *
 * @param path      absolute service path, e.g. '/v1/data-sources/sql/test'
 * @param body      request payload (may contain decrypted credentials)
 * @param timeoutMs abort threshold; pick from PYTHON_TIMEOUT
 * @param signal    optional caller-owned cancellation, combined with the
 *                  timeout. The preprocessing job runner passes its per-job
 *                  token here so a cancel takes effect DURING an operation
 *                  rather than only at the next boundary between operations —
 *                  with `preprocess` at 300s, "cancel" would otherwise mean
 *                  "cancel in up to five minutes", which reads as broken.
 */
export async function postToPython<TRes>(
  path: string,
  body: unknown,
  timeoutMs: number = PYTHON_TIMEOUT.fetch,
  signal?: AbortSignal,
): Promise<TRes> {
  return send<TRes>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
    signal,
  );
}

/**
 * POST a multipart body to the FastAPI connector.
 *
 * Exists because `postToPython` hardcodes `Content-Type: application/json` and
 * `JSON.stringify`, neither of which survives a file upload. Both funnel
 * through `send` so the timeout shape and the 504/502/499/400 mapping cannot
 * drift apart — a second copy of that except-chain would eventually answer 502
 * where its sibling answers 400, and callers would have to special-case it.
 *
 * The `Content-Type` header is deliberately NOT set: undici derives it from the
 * FormData and appends the boundary. Setting it by hand drops the boundary and
 * the upstream parser sees a body with no parts.
 *
 * Buffered, not streamed. `@fastify/multipart` already caps the upload well
 * below anything worth streaming, and piping a Fastify part through undici
 * would be new plumbing for no gain at that size.
 */
export async function postMultipartToPython<TRes>(
  path: string,
  form: FormData,
  timeoutMs: number = PYTHON_TIMEOUT.metadata,
  signal?: AbortSignal,
): Promise<TRes> {
  return send<TRes>(path, { method: 'POST', body: form }, timeoutMs, signal);
}

/**
 * Shared transport for every call in this module: one timeout shape, one error
 * mapping. Callers differ only in how they encode the body.
 */
async function send<TRes>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TRes> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Do NOT include `err` details verbatim — they can echo the request.
    if (err instanceof AppException) throw err;
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    // A caller-triggered abort is not a connector fault. Distinguishing it
    // lets the runner record CANCELED instead of FAILED.
    if (!timedOut && signal?.aborted) {
      throw new AppException({
        statusCode: 499,
        message: 'Data connector request was canceled by the caller.',
        type: 'ERROR',
      });
    }
    throw new AppException({
      statusCode: timedOut ? 504 : 502,
      message: timedOut
        ? `Data connector request timed out after ${timeoutMs}ms.`
        : 'Cannot reach the data connector service.',
      type: 'ERROR',
    });
  }

  if (!res.ok) {
    let detail = `Data connector error (${res.status}).`;
    try {
      const parsed = (await res.json()) as FastApiError;
      if (parsed?.detail) detail = parsed.detail;
    } catch {
      // non-JSON error body — keep the generic message
    }
    // Map upstream 4xx (bad connection config / auth) through as a 400 so the
    // caller can relay it; 5xx stays a 502 (connector fault, not client).
    throw new AppException({
      statusCode: res.status >= 400 && res.status < 500 ? 400 : 502,
      message: detail,
      type: 'ERROR',
    });
  }

  return (await res.json()) as TRes;
}
