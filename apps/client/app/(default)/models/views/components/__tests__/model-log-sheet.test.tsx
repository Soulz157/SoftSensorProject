import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AIModel } from '@/types'
import type { WindowLogs } from '@/services/inference-window'
import { ModelLogSheet } from '../model-log-sheet'

/**
 * MODEL-SERVE-001-T11/V10/V11. This is the surface whose gap was real:
 * before T11 this sheet showed only a status badge and `windowStart` — none
 * of windowEnd/inputRows/missingPct, which `window-logs-tab.tsx` already
 * rendered. V11 needed both surfaces to agree; this file proves it here and
 * (paired with window-logs-tab.test.tsx) across both.
 */

const h = vi.hoisted(() => ({
  logs: null as WindowLogs | null,
}))

vi.mock('@/hooks/model/use-window-logs', () => ({
  useWindowLogs: () => ({
    logs: h.logs,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const MODEL = {
  id: 'model-1',
  workspaceId: 'ws-1',
  name: 'Boiler soft sensor',
  data: {
    deployStatus: 'running',
    prodStatus: 'normal',
    editHistory: [],
    logs: [],
  },
} as unknown as AIModel

const SKIPPED_LOGS: WindowLogs = {
  window: {
    id: 'w-skipped',
    status: 'SKIPPED',
    windowStart: '2026-09-14T06:00:00.000Z',
    windowEnd: '2026-09-14T07:00:00.000Z',
    inputRows: 20,
    missingPct: 0.05,
    imageDigest: null,
    containerId: null,
    failureReason: 'Only 20 usable row(s), below INFERENCE_MIN_ROWS (30).',
    attempts: 0,
    startedAt: null,
    finishedAt: '2026-09-14T06:19:08.000Z',
  },
  provenance: {
    deployedAt: null,
    deployedBy: null,
    version: 1,
    stage: 'PRODUCTION',
    promotedAt: null,
    promotedBy: null,
    promotionOverrideReason: null,
  },
  lines: [],
  truncated: false,
  omittedCount: 0,
}

const FAILED_LOGS: WindowLogs = {
  ...SKIPPED_LOGS,
  window: {
    ...SKIPPED_LOGS.window,
    id: 'w-failed',
    status: 'FAILED',
    failureReason:
      'Materialize failed: Cannot reach the data connector service.',
  },
}

beforeEach(() => {
  h.logs = null
})

describe('ModelLogSheet (MODEL-SERVE-001-T11/V10/V11)', () => {
  it('V11: a SKIPPED window puts the reason, missingPct, and windowStart/windowEnd in the DOM together', () => {
    h.logs = SKIPPED_LOGS

    render(<ModelLogSheet model={MODEL} open onClose={vi.fn()} />)

    // The skip reason, via the shared describeEmptyWindowLog card body.
    expect(
      screen.getByText('Only 20 usable row(s), below INFERENCE_MIN_ROWS (30).'),
    ).toBeInTheDocument()
    // missingPct, same wording window-logs-tab.tsx uses — one vocabulary.
    expect(screen.getByText('5.0% missing')).toBeInTheDocument()
    // inputRows, same strip.
    expect(screen.getByText('20 input rows')).toBeInTheDocument()
    // windowEnd is now on the strip too, not just windowStart.
    expect(
      screen.getByText(
        new RegExp(
          new Date(SKIPPED_LOGS.window.windowEnd).toLocaleTimeString(),
        ),
      ),
    ).toBeInTheDocument()
  })

  it('V11: SKIPPED is visually distinct from FAILED — no shared "error" wording', () => {
    h.logs = SKIPPED_LOGS
    render(<ModelLogSheet model={MODEL} open onClose={vi.fn()} />)
    expect(screen.getByText('SKIPPED')).toBeInTheDocument()
    expect(
      screen.queryByText('Failed before a container started'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Skipped — too few rows to score'),
    ).toBeInTheDocument()
  })

  it('FAILED before spawn renders its own reason, distinctly from SKIPPED', () => {
    h.logs = FAILED_LOGS
    render(<ModelLogSheet model={MODEL} open onClose={vi.fn()} />)
    expect(
      screen.getByText('Failed before a container started'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Skipped — too few rows to score'),
    ).not.toBeInTheDocument()
  })
})
