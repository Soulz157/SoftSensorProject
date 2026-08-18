import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { fetchPiTags, PiError } from '@/lib/pi/server'

export const runtime = 'nodejs'

// GET /api/pi/tags?name_filter=*&max_count=10 — search the PI tag catalog.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const nameFilter = searchParams.get('name_filter') ?? undefined
  const maxCountRaw = searchParams.get('max_count')
  const maxCount = maxCountRaw !== null ? Number(maxCountRaw) : undefined
  if (maxCount !== undefined && (!Number.isInteger(maxCount) || maxCount < 1)) {
    return NextResponse.json(
      { error: 'max_count must be a positive integer' },
      { status: 400 },
    )
  }

  try {
    const tags = await fetchPiTags({
      name_filter: nameFilter,
      max_count: maxCount,
    })
    return NextResponse.json(tags)
  } catch (err) {
    const status = err instanceof PiError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status })
  }
}
