import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { fetchPiBatchData, PiError } from '@/lib/pi/server'
import type { DataFetchRequest } from '@/types/pi'

export const runtime = 'nodejs'

// POST /api/pi/data — batch-fetch time-series data for the given tags/range.
// Body: DataFetchRequest. Partial failures come back inside results[].status
// with HTTP 200 — this handler only errors on transport/validation problems.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: DataFetchRequest
  try {
    body = (await req.json()) as DataFetchRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.tag_list) || body.tag_list.length === 0) {
    return NextResponse.json(
      { error: 'tag_list must be a non-empty array' },
      { status: 400 },
    )
  }
  if (!body.start_time || !body.end_time) {
    return NextResponse.json(
      { error: 'start_time and end_time are required' },
      { status: 400 },
    )
  }

  try {
    const data = await fetchPiBatchData(body)
    return NextResponse.json(data)
  } catch (err) {
    const status = err instanceof PiError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status })
  }
}
