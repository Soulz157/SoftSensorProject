import { Logger } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';

/**
 * DS-LAKE-005B-C-T07 (large-dataset observability, server-side slice).
 * `fetchOk` is the ONE choke point every export in this module funnels
 * through — the natural place to log API latency (backend's-eye view,
 * includes network + FastAPI's own `_run` time), response bytes, and this
 * PROCESS's memory at call time, without threading instrumentation through
 * every individual `postToPython`/`postBinaryToPython`/`postMultipartToPython`
 * call site. `new Logger(...)` outside a NestJS-managed class is standard —
 * this file is a plain module, not an `@Injectable`, so there is no DI
 * context to inject a scoped logger from.
 */
const logger = new Logger('PythonClient');

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
  metadata: 300_000,
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
 * Shared transport for every call in this module: one timeout shape, one
 * error mapping. Returns the raw, already-`ok` `Response` — callers decide
 * how to read the body (`.json()` for `send`, `.arrayBuffer()` for the
 * binary path DS-LAKE-005B-A-T05 added), so a divergence in how JSON vs
 * binary responses are FETCHED cannot happen; only how they're DECODED can
 * differ, which is inherent to the two formats.
 */
async function fetchOk(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Logged BEFORE the existing error mapping below — a network failure or
    // timeout is exactly the kind of thing DS-LAKE-005B-C-T07 wants a
    // latency figure for too, not just the happy path. `path` only (a
    // hardcoded route string like '/v1/preprocess/clean'), never `err`
    // itself, same "no request detail in a log" rule this file's own
    // module docstring states for error messages.
    logger.warn(
      `python_request_failed path=${path} elapsed_ms=${Date.now() - started}`,
    );
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

  // DS-LAKE-005B-C-T07 (large-dataset observability, server-side slice):
  // logged for EVERY response, ok or not — a slow 422/502 is still a
  // latency data point. `content-length` is what Python/undici actually
  // set on the wire; falls back to '?' rather than 0 when absent (chunked
  // responses have no header) so the log line cannot be misread as "zero
  // bytes transferred". `process.memoryUsage().rss` is this NODE
  // PROCESS's own resident set at call time, not a per-request delta —
  // same "process-level snapshot, not a profile" scope as Python's
  // `_peak_rss_kb()` (routers/preprocess.py) on the other side of this hop.
  logger.log(
    `python_request path=${path} status=${res.status} elapsed_ms=${Date.now() - started} bytes=${res.headers.get('content-length') ?? '?'} rss_mb=${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)}`,
  );

  if (!res.ok) {
    let detail = `Data connector error (${res.status}).`;
    try {
      // FastAPI's HTTPException body is always `{detail: ...}` JSON,
      // regardless of what format the SUCCESS response would have been —
      // safe to assume here even on the binary path.
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

  return res;
}

async function send<TRes>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TRes> {
  const res = await fetchOk(path, init, timeoutMs, signal);
  return (await res.json()) as TRes;
}

/**
 * What `postBinaryToPython` hands back — the raw bytes plus enough of the
 * response to reconstruct it for the browser (content type, and whichever
 * envelope headers the connector set, e.g. the `X-Total-Row-Count` family
 * DS-LAKE-005B-A-T05's `/rows?format=arrow` sends).
 */
export interface BinaryPythonResponse {
  buffer: Buffer;
  contentType: string;
  headers: Record<string, string>;
}

/**
 * POST a JSON body to the FastAPI connector and return the RAW response
 * body, undecoded — for a wire format `postToPython`'s `res.json()` cannot
 * parse (DS-LAKE-005B-A-T05: Arrow IPC). Deliberately a SEPARATE function
 * rather than widening `postToPython<TRes>`'s return type to a union —
 * that would force every existing JSON caller to narrow a type it never
 * needed to think about.
 *
 * NOTE: the parse-never-cast Zod boundary every other connector response in
 * this codebase goes through (`PythonRowsSchema` etc.) does not apply here —
 * there is nothing to validate an opaque byte buffer against. This is a
 * deliberate, explicit gap for a format with no NestJS-side reader yet.
 */
export async function postBinaryToPython(
  path: string,
  body: unknown,
  timeoutMs: number = PYTHON_TIMEOUT.fetch,
  signal?: AbortSignal,
): Promise<BinaryPythonResponse> {
  const res = await fetchOk(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
    signal,
  );
  const buffer = Buffer.from(await res.arrayBuffer());
  const headers: Record<string, string> = {};
  for (const [key, value] of res.headers.entries()) {
    if (key.toLowerCase().startsWith('x-')) headers[key] = value;
  }
  return {
    buffer,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    headers,
  };
}
