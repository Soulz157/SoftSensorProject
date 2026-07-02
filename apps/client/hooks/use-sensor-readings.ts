import { useEffect, useState } from 'react'
import {
  generateReadings,
  latestReading,
  type SensorReading,
  type TimeRange,
} from '@/lib/mock-readings'

/** One merged-by-timestamp row: `{ timestamp, [piTag]: value }`. */
export interface SensorChartRow {
  timestamp: string
  [piTag: string]: string | number | null
}

export interface UseSensorReadingsResult {
  /** Merged series for the multi-line chart. */
  rows: SensorChartRow[]
  /** Latest reading per tag, for the KPI strip. */
  latest: Record<string, SensorReading>
  /** True only on the very first load (no data yet). */
  loading: boolean
  /** True while any regeneration is in flight. */
  isFetching: boolean
}

/**
 * Sensor readings for the selected PI tags + time range.
 *
 * Currently backed by the in-memory mock generator; swap the body of the
 * effect for `services/readings.ts` (`fetchClient`) when Phase 6 lands — the
 * return shape stays identical.
 *
 * keepPreviousData: previous `rows`/`latest` stay visible during regeneration;
 * the chart never blanks on a tag toggle or range switch.
 */
export function useSensorReadings(
  piTags: string[],
  range: TimeRange,
): UseSensorReadingsResult {
  const [rows, setRows] = useState<SensorChartRow[] | null>(null)
  const [latest, setLatest] = useState<Record<string, SensorReading>>({})
  const [isFetching, setIsFetching] = useState(false)

  // Stable primitive dep; avoids re-running on a new array identity.
  const tagsKey = piTags.join(',')

  useEffect(() => {
    let cancelled = false
    setIsFetching(true)

    // setTimeout simulates the async API the real service will use.
    const timer = setTimeout(() => {
      if (cancelled) return

      const tags = tagsKey ? tagsKey.split(',') : []
      // Shared `now` so every tag samples the same timestamp grid; otherwise a
      // sub-ms straddle between calls splits tags onto separate merged rows.
      const now = Date.now()
      const perTag = tags.map(tag => ({
        tag,
        readings: generateReadings(tag, range, now),
      }))

      // Merge all series by timestamp into chart rows.
      const byTs = new Map<string, SensorChartRow>()
      for (const { tag, readings } of perTag) {
        for (const r of readings) {
          const row = byTs.get(r.timestamp) ?? { timestamp: r.timestamp }
          row[tag] = r.value
          byTs.set(r.timestamp, row)
        }
      }
      const merged = Array.from(byTs.values()).sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : 1,
      )

      const latestMap: Record<string, SensorReading> = {}
      for (const { tag, readings } of perTag) {
        const lr = latestReading(readings)
        if (lr) latestMap[tag] = lr
      }

      // Never reset to null here — keep previous data visible.
      setRows(merged)
      setLatest(latestMap)
      setIsFetching(false)
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tagsKey, range])

  return {
    rows: rows ?? [],
    latest,
    loading: isFetching && rows === null,
    isFetching,
  }
}
