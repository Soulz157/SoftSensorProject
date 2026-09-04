'use client'

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { pickTimeFormat } from '@/lib/monitoring'
import { ALGORITHM_LABELS, type Algorithm } from '@/store/model-pipeline'
import type {
  CandidateResult,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { AXIS_TICK } from '../evaluation/actual-vs-predicted-chart'

interface Props {
  /** One phase group's candidates (`CandidateGroups`' own phase1/phase2
   *  split) — every candidate in ONE ModelCandidateJob shares the job's
   *  own goldArtifactId/targetY/trainTestSplit, so they are ALWAYS
   *  split-comparable by construction. No comparability check is needed
   *  here the way `StandaloneComparison`'s cross-job rows need one. */
  candidates: CandidateResult[]
  byRunId: Map<string, RunPredictionsBatchItem>
}

const OVERLAY_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

interface OverlayRow {
  t: number
  timestamp: string
  actual: number | null
  [predKey: string]: number | string | null
}

/**
 * Merges each candidate's OWN decimated series onto one shared timeline,
 * keyed by timestamp rather than assumed positionally aligned. Candidates
 * in the same job share an identical `y_true` — LTTB bucketing keyed on
 * (timestamp, y_true) (`run_predictions_batch`'s own docstring) therefore
 * keeps the SAME timestamps for every candidate, so `actual` agrees
 * wherever two candidates' series overlap; this still merges by key rather
 * than trusting that agreement, in case an artifact ever disagrees.
 */
function buildOverlayRows(
  entries: { runId: string; item: RunPredictionsBatchItem }[],
): OverlayRow[] {
  const byTimestamp = new Map<string, OverlayRow>()
  for (const { runId, item } of entries) {
    for (const p of item.points) {
      let row = byTimestamp.get(p.timestamp)
      if (!row) {
        row = {
          t: Date.parse(p.timestamp),
          timestamp: p.timestamp,
          actual: p.yTrue,
        }
        byTimestamp.set(p.timestamp, row)
      }
      row[`pred_${runId}`] = p.yPred
    }
  }
  return Array.from(byTimestamp.values()).sort((a, b) => a.t - b.t)
}

/**
 * MODEL-FLOW-017. One full-width chart per phase group: actual once, each
 * candidate's prediction as its own series — divergence between close
 * candidates is directly comparable in a way no small multiple can be.
 * Answers a THIRD question, distinct from either per-candidate chart:
 * "which candidate tracks reality best", not "does this one" or "did it
 * converge".
 *
 * Renders nothing for a group with no readable candidate — the small
 * multiples below still show each candidate's own honest state, so this
 * chart's absence is not the group's only signal.
 */
export function CandidateOverlayChart({ candidates, byRunId }: Props) {
  const entries = candidates
    .filter(c => c.runId && byRunId.has(c.runId))
    .map(c => ({
      candidate: c,
      runId: c.runId as string,
      item: byRunId.get(c.runId as string) as RunPredictionsBatchItem,
    }))
    .filter(({ item }) => !item.error && item.points.length > 0)

  if (entries.length === 0) return null

  const rows = buildOverlayRows(entries)
  const first = rows[0]
  const last = rows[rows.length - 1]
  const tickFormatter = pickTimeFormat(first && last ? last.t - first.t : 0)
  const anyDownsampled = entries.some(({ item }) => item.downsampled)
  const maxRowCount = Math.max(...entries.map(({ item }) => item.rowCount ?? 0))

  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-foreground">
          Which candidate tracks reality best?
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" /> Actual
          </span>
          {entries.map(({ candidate, runId }, i) => (
            <span key={runId} className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: OVERLAY_COLORS[i % OVERLAY_COLORS.length],
                }}
              />
              {ALGORITHM_LABELS[candidate.algorithm as Algorithm] ??
                candidate.algorithm}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={tickFormatter}
            tick={AXIS_TICK}
            stroke="var(--border)"
            minTickGap={40}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={AXIS_TICK}
            stroke="var(--border)"
            width={48}
            tickFormatter={v => Number(v).toFixed(1)}
          />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            labelFormatter={v => tickFormatter(Number(v))}
          />
          <Line
            connectNulls
            type="monotone"
            dataKey="actual"
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {entries.map(({ runId }, i) => (
            <Line
              key={runId}
              connectNulls
              type="monotone"
              dataKey={`pred_${runId}`}
              stroke={OVERLAY_COLORS[i % OVERLAY_COLORS.length]}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      {anyDownsampled && (
        <p className="text-[10px] text-muted-foreground">
          {rows.length} of {maxRowCount} points shown per candidate
        </p>
      )}
    </div>
  )
}
