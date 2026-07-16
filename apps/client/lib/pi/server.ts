/**
 * Server-only client for the FastAPI PI service (apps/python).
 *
 * All PI traffic flows through here so PI credentials and the service URL stay
 * server-side. Route handlers under app/api/pi/* call these functions; nothing
 * in the browser should import this module.
 *
 * Contract mirrors apps/python/schemas/data.py (see @/types/pi).
 */
import type {
  DataFetchRequest,
  DataFetchResponse,
  PiHealth,
  TagListResponse,
  TagSearchParams,
} from '@/types/pi'

// Hard guard: this module reads a server-side env var and must never run client-side.
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/pi/server.ts is server-only and must not be imported into client code.',
  )
}

const HEALTH_TIMEOUT_MS = 15_000
const TAGS_TIMEOUT_MS = 15_000
const DATA_TIMEOUT_MS = 60_000 // batch summaries over a range can be slow

/** Error carrying the HTTP status the route handler should respond with. */
export class PiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'PiError'
    this.status = status
  }
}

function baseUrl(): string {
  const url = process.env.PYTHON_API_URL
  if (!url) {
    throw new PiError(500, 'PYTHON_API_URL is not configured (server env).')
  }
  return url.replace(/\/+$/, '')
}

interface FastApiError {
  detail?: string
}

async function piFetch<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    if (err instanceof PiError) throw err // e.g. missing env from baseUrl()
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new PiError(504, `PI request timed out after ${timeoutMs}ms`)
    }
    throw new PiError(502, 'Cannot reach the PI data service')
  }

  if (!res.ok) {
    let detail = `PI service error (${res.status})`
    try {
      const body = (await res.json()) as FastApiError
      if (body?.detail) detail = body.detail
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new PiError(res.status, detail)
  }

  return (await res.json()) as T
}

/** 1. Connection validation — pings the PI service's real health endpoint. */
export function verifyPiConnection(): Promise<PiHealth> {
  return piFetch<PiHealth>(
    '/v1/pi/health',
    { method: 'GET' },
    HEALTH_TIMEOUT_MS,
  )
}

/** 2a. Fetch the tag catalog (PI point search). */
export function fetchPiTags(
  params: TagSearchParams = {},
): Promise<TagListResponse> {
  const qs = new URLSearchParams({
    name_filter: params.name_filter ?? '*',
    max_count: String(params.max_count ?? 10),
  })
  return piFetch<TagListResponse>(
    `/v1/tags/?${qs.toString()}`,
    { method: 'GET' },
    TAGS_TIMEOUT_MS,
  )
}

/**
 * 2b. Batch-fetch time-series data. Batching/retry/per-tag fallback happens in
 * Python (fetch_tags_in_batches); `batch_size` on the body controls chunking.
 * Partial failures are NOT thrown — inspect `results[].status` in the response.
 */
export function fetchPiBatchData(
  body: DataFetchRequest,
): Promise<DataFetchResponse> {
  return piFetch<DataFetchResponse>(
    '/v1/data/fetch',
    { method: 'POST', body: JSON.stringify(body) },
    DATA_TIMEOUT_MS,
  )
}
