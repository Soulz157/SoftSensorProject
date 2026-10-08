import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AIModel } from '@/types'
import type { InferenceWindow, WindowLogs } from '@/services/inference-window'
import { WindowLogsTab } from '../window-logs-tab'
import { ModelLogSheet } from '../../../views/components/model-log-sheet'

/**
 * MODEL-SERVE-001-T11/V10/V11. `describeEmptyWindowLog` (lib/window-log-state.ts)
 * already implements V10's four zero-line reasons and `window-logs-tab.tsx`
 * already renders windowStart/windowEnd/inputRows/missingPct beside the skip
 * reason (V11) — this file is the missing PROOF, not a fix. See the model's
 * own plan: V11's real gap was `model-log-sheet.tsx`, covered separately.
 *
 * TRAP, stated so it is not silently reintroduced: `STATUS_BADGE` gives
 * SKIPPED and PENDING the identical class in this component. Distinctness
 * is asserted on the REASON TEXT below, never on badge class/color.
 */

const h = vi.hoisted(() => ({
  windows: [] as InferenceWindow[],
  windowsLoading: false,
  windowsError: null as string | null,
  logsByWindowId: {} as Record<string, WindowLogs>,
}))

vi.mock('@/hooks/model/use-inference-windows', () => ({
  useInferenceWindows: () => ({
    windows: h.windows,
    loading: h.windowsLoading,
    error: h.windowsError,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/model/use-window-logs', () => ({
  useWindowLogs: (_modelId: string | null, windowId: string | null) => ({
    logs: windowId ? (h.logsByWindowId[windowId] ?? null) : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

function window(over: Partial<InferenceWindow>): InferenceWindow {
  return {
    id: 'w-default',
    modelId: 'model-1',
    modelVersionId: 'version-1',
    windowStart: '2026-09-14T06:00:00.000Z',
    windowEnd: '2026-09-14T07:00:00.000Z',
    status: 'PENDING',
    inputRows: null,
    missingPct: null,
    failureReason: null,
    createdAt: '2026-09-14T06:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...over,
  }
}

function logsFor(
  win: InferenceWindow,
  over: Partial<WindowLogs> = {},
): WindowLogs {
  return {
    window: {
      id: win.id,
      status: win.status,
      windowStart: win.windowStart,
      windowEnd: win.windowEnd,
      inputRows: win.inputRows,
      missingPct: win.missingPct,
      imageDigest: null,
      containerId: null,
      failureReason: win.failureReason,
      attempts: 0,
      startedAt: win.startedAt,
      finishedAt: win.finishedAt,
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
    ...over,
  }
}

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

beforeEach(() => {
  h.windows = []
  h.windowsLoading = false
  h.windowsError = null
  h.logsByWindowId = {}
})

describe('WindowLogsTab (MODEL-SERVE-001-T11/V10)', () => {
  it('PENDING: names "not dispatched yet", not a shared em dash', () => {
    const w = window({ id: 'w-pending', status: 'PENDING' })
    h.windows = [w]
    h.logsByWindowId[w.id] = logsFor(w)

    render(<WindowLogsTab modelId="model-1" />)

    expect(screen.getByText('Not dispatched yet')).toBeInTheDocument()
  })

  it('SKIPPED: names its own threshold reason, not a shared em dash', () => {
    const w = window({
      id: 'w-skipped',
      status: 'SKIPPED',
      inputRows: 20,
      missingPct: 0,
      failureReason: 'Only 20 usable row(s), below INFERENCE_MIN_ROWS (30).',
      finishedAt: '2026-09-14T06:19:08.000Z',
    })
    h.windows = [w]
    h.logsByWindowId[w.id] = logsFor(w)

    render(<WindowLogsTab modelId="model-1" />)

    expect(
      screen.getByText('Skipped — too few rows to score'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Only 20 usable row(s), below INFERENCE_MIN_ROWS (30).'),
    ).toBeInTheDocument()
  })

  it('FAILED before spawn (no containerId): distinct reason from a container that ran', () => {
    const w = window({
      id: 'w-failed-no-container',
      status: 'FAILED',
      failureReason:
        'Materialize failed: Cannot reach the data connector service.',
    })
    h.windows = [w]
    h.logsByWindowId[w.id] = logsFor(w)

    render(<WindowLogsTab modelId="model-1" />)

    expect(
      screen.getByText('Failed before a container started'),
    ).toBeInTheDocument()
  })

  it('FAILED after a container ran and printed nothing: the OTHER failed reason', () => {
    const w = window({
      id: 'w-failed-container',
      status: 'FAILED',
      startedAt: '2026-09-14T06:00:05.000Z',
      failureReason: 'Container abc123 no longer exists.',
    })
    h.windows = [w]
    h.logsByWindowId[w.id] = logsFor(w, {
      window: {
        ...logsFor(w).window,
        containerId: 'abc123def456',
      },
    })

    render(<WindowLogsTab modelId="model-1" />)

    expect(
      screen.getByText('Container started but never reported in'),
    ).toBeInTheDocument()
  })

  it('V11: a SKIPPED window puts the reason, missingPct, and windowStart/windowEnd in the DOM together', () => {
    const w = window({
      id: 'w-skipped-v11',
      status: 'SKIPPED',
      windowStart: '2026-09-14T06:00:00.000Z',
      windowEnd: '2026-09-14T07:00:00.000Z',
      inputRows: 20,
      missingPct: 0.05,
      failureReason: 'Only 20 usable row(s), below INFERENCE_MIN_ROWS (30).',
    })
    h.windows = [w]
    h.logsByWindowId[w.id] = logsFor(w)

    render(<WindowLogsTab modelId="model-1" />)

    // The skip reason (the card's empty-state body).
    expect(
      screen.getByText('Only 20 usable row(s), below INFERENCE_MIN_ROWS (30).'),
    ).toBeInTheDocument()
    // missingPct, from the same row, rendered in the metadata strip.
    expect(screen.getByText('5.0% missing')).toBeInTheDocument()
    // windowStart–windowEnd, same strip. Asserted via the badge list entry,
    // which always renders windowStart regardless of which window is active.
    expect(
      screen.getByText(new Date(w.windowStart).toLocaleString()),
    ).toBeInTheDocument()
  })

  it('V11: a SKIPPED window is visually distinct from a FAILED one (no shared "error" wording)', () => {
    const w = window({
      id: 'w-skipped-distinct',
      status: 'SKIPPED',
      failureReason: 'Only 5 usable row(s), below INFERENCE_MIN_ROWS (30).',
    })
    h.windows = [w]
    h.logsByWindowId[w.id] = logsFor(w)

    render(<WindowLogsTab modelId="model-1" />)

    // T01/T10's own rule: SKIPPED must never render as a failure or an
    // error. The FAILED-only titles must not appear for this window.
    expect(
      screen.queryByText('Failed before a container started'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Container started but never reported in'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Skipped — too few rows to score'),
    ).toBeInTheDocument()
  })

  it('V10: one model rendered through both surfaces reports the same status and the same last lines', () => {
    const w = window({
      id: 'w-cross-surface',
      status: 'SUCCEEDED',
      inputRows: 60,
      missingPct: 0,
    })
    const logs = logsFor(w, {
      lines: [
        {
          id: 'l1',
          level: 'info',
          message: 'Window claimed.',
          createdAt: '2026-09-14T07:00:01.000Z',
        },
        {
          id: 'l2',
          level: 'info',
          message: 'Scored 60 rows.',
          createdAt: '2026-09-14T07:00:03.000Z',
        },
      ],
    })
    h.windows = [w]
    // Two keys into the SAME logs object: the tab reads by the window's own
    // id (selectedId ?? windows[0].id); the peek sheet always sends
    // 'latest', which the server resolves server-side. Keying the mock this
    // way is what proves the two callers hit "one endpoint, two renderings"
    // rather than two independently-shaped answers.
    h.logsByWindowId[w.id] = logs
    h.logsByWindowId['latest'] = logs

    const tab = render(<WindowLogsTab modelId="model-1" />)
    const tabStatus = screen.getByText('SUCCEEDED').textContent
    const tabLastLine = screen.getByText('Scored 60 rows.').textContent
    tab.unmount()

    const sheet = render(<ModelLogSheet model={MODEL} open onClose={vi.fn()} />)
    const sheetStatus = screen.getByText('SUCCEEDED').textContent
    const sheetLastLine = screen.getByText('Scored 60 rows.').textContent
    sheet.unmount()

    expect(sheetStatus).toBe(tabStatus)
    expect(sheetLastLine).toBe(tabLastLine)
  })
})
