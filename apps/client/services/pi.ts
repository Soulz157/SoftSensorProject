/**
 * Client-side wrappers over the same-origin PI BFF (app/api/pi/*).
 *
 * Uses relative URLs, NOT lib/fetcher — fetchClient targets the NestJS backend
 * (NEXT_PUBLIC_API_URL); PI traffic must go through this app's own /api/pi/*
 * route handlers, which validate the session and proxy to FastAPI.
 */
import type {
  DataFetchRequest,
  DataFetchResponse,
  PiHealth,
  TagListResponse,
  TagSearchParams,
} from '@/types/pi'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function getPiHealth(): Promise<PiHealth> {
  return unwrap<PiHealth>(await fetch('/api/pi/health'))
}

export async function getPiTags(
  params: TagSearchParams = {},
): Promise<TagListResponse> {
  const qs = new URLSearchParams()
  if (params.name_filter) qs.set('name_filter', params.name_filter)
  if (params.max_count !== undefined) {
    qs.set('max_count', String(params.max_count))
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return unwrap<TagListResponse>(await fetch(`/api/pi/tags${suffix}`))
}

export async function postPiData(
  body: DataFetchRequest,
): Promise<DataFetchResponse> {
  return unwrap<DataFetchResponse>(
    await fetch('/api/pi/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}
