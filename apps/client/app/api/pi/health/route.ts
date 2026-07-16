import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { PiError, verifyPiConnection } from '@/lib/pi/server'

export const runtime = 'nodejs'

// GET /api/pi/health — verify the PI service connection.
export async function GET() {
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const health = await verifyPiConnection()
    return NextResponse.json(health)
  } catch (err) {
    const status = err instanceof PiError ? err.status : 500
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status })
  }
}
