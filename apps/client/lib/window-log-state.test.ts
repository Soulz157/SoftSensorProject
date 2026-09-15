import { describe, expect, it } from 'vitest'
import {
  describeEmptyWindowLog,
  describeLogTruncation,
} from './window-log-state'
import type { WindowLogContext } from '@/services/inference-window'

function windowOf(
  status: WindowLogContext['status'],
  failureReason: string | null = null,
): WindowLogContext {
  return {
    id: 'window-1',
    status,
    windowStart: '2026-09-14T10:00:00.000Z',
    windowEnd: '2026-09-14T11:00:00.000Z',
    inputRows: null,
    missingPct: null,
    imageDigest: null,
    containerId: null,
    failureReason,
    attempts: 1,
    startedAt: null,
    finishedAt: null,
  }
}

describe('describeEmptyWindowLog (MODEL-SERVE-001-T10)', () => {
  it('gives every status its OWN sentence — the whole point of the task', () => {
    const titles = (
      [
        'PENDING',
        'RUNNING',
        'SKIPPED',
        'FAILED',
        'SUCCEEDED',
        'CANCELED',
      ] as const
    ).map(s => describeEmptyWindowLog(windowOf(s)).title)

    expect(new Set(titles).size).toBe(titles.length)
  })

  // MODEL-SERVE-001-T20.
  it('distinguishes CANCELED (operator stopped it) from SKIPPED (a data threshold)', () => {
    const { title, detail } = describeEmptyWindowLog(windowOf('CANCELED'))
    expect(title).toMatch(/cancel/i)
    expect(`${title} ${detail}`).not.toMatch(/fail/i)
    expect(`${title} ${detail}`).not.toMatch(/threshold|row/i)
  })

  it('prefers CANCELED’s own failureReason over the generic sentence', () => {
    const reason = 'Stopped by ada@example.com'
    expect(describeEmptyWindowLog(windowOf('CANCELED', reason)).detail).toBe(
      reason,
    )
  })

  it('does not call a PENDING window a failure', () => {
    const { title, detail } = describeEmptyWindowLog(windowOf('PENDING'))
    expect(title).toMatch(/not dispatched/i)
    expect(`${title} ${detail}`).not.toMatch(/fail/i)
  })

  it('treats SKIPPED as a real terminal status, not a synonym for FAILED', () => {
    // MODEL-SERVE-006-T01 is explicit that SKIPPED is its own outcome: a
    // quiet plant, not an incident.
    const { title, detail } = describeEmptyWindowLog(windowOf('SKIPPED'))
    expect(`${title} ${detail}`).toMatch(/skipped/i)
    expect(title).not.toMatch(/fail/i)
  })

  it('prefers the window’s own failureReason over the generic sentence', () => {
    const reason = 'Only 3 row(s) in window, below INFERENCE_MIN_ROWS'
    expect(describeEmptyWindowLog(windowOf('SKIPPED', reason)).detail).toBe(
      reason,
    )
    expect(describeEmptyWindowLog(windowOf('FAILED', reason)).detail).toBe(
      reason,
    )
  })

  it('distinguishes a FAILED window that never spawned a container', () => {
    // infer.py logs "Window claimed." before it downloads anything, so a
    // container that got that far always wrote a line. Zero lines means no
    // container reached the claim — a different place to go looking.
    const { title } = describeEmptyWindowLog(windowOf('FAILED'))
    expect(title).toMatch(/before a container started/i)
  })

  it('distinguishes a FAILED window whose container ran but said nothing', () => {
    // VERIFIED LIVE against TM2: 20 of its 50 FAILED windows carry a
    // containerId and a startedAt, having been reaped by a server restart
    // before reaching claim. Calling those "failed before a container
    // started" would send the operator to the wrong place.
    const w = { ...windowOf('FAILED'), containerId: 'abc123def456' }
    expect(describeEmptyWindowLog(w).title).toMatch(/never reported in/i)
  })

  it('uses containerId, NOT imageDigest, to tell those two apart', () => {
    // imageDigest is null in BOTH cases on real rows, so keying off it
    // would collapse the distinction entirely.
    const ran = { ...windowOf('FAILED'), containerId: 'abc', imageDigest: null }
    const never = {
      ...windowOf('FAILED'),
      containerId: null,
      imageDigest: null,
    }
    expect(describeEmptyWindowLog(ran).title).not.toBe(
      describeEmptyWindowLog(never).title,
    )
  })

  it('flags a SUCCEEDED window with no output as suspect rather than reassuring', () => {
    const { detail } = describeEmptyWindowLog(windowOf('SUCCEEDED'))
    expect(detail).toMatch(/caution/i)
  })
})

describe('describeLogTruncation (MODEL-SERVE-001-T10)', () => {
  it('says nothing when nothing was dropped', () => {
    expect(describeLogTruncation(false, 0)).toBeNull()
  })

  it('states the real number of omitted lines, not a bare "truncated"', () => {
    // The training-run read caps at 500 silently; T10 requires the cap be
    // stated on screen when it bites.
    const note = describeLogTruncation(true, 120)
    expect(note).toContain('120')
    expect(note).toMatch(/earlier lines omitted/i)
    expect(note).toContain('500')
  })

  it('singularises one omitted line', () => {
    expect(describeLogTruncation(true, 1)).toMatch(/1 earlier line omitted/i)
  })
})
