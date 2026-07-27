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
 */
export async function postToPython<TRes>(
  path: string,
  body: unknown,
  timeoutMs: number = PYTHON_TIMEOUT.fetch,
): Promise<TRes> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Do NOT include `err` details verbatim — they can echo the request.
    if (err instanceof AppException) throw err;
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
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
