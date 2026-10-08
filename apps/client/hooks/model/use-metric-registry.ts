'use client'

import { useEffect, useState } from 'react'
import { metricRegistryService } from '@/services/metric-registry'
import { METRIC_KEYS, type MetricKey } from '@/lib/model-metrics'

/**
 * MODEL-SERVE-006-T08 (Pass B, evaluation-only scope). The metric picker's
 * available OPTIONS now come from the server registry — a real selection
 * over a declared, backfillable-flagged set, not a filter over a bare
 * client constant. Falls back to `METRIC_KEYS` while loading or on error:
 * this must never block or empty the picker, since today's registry
 * mirrors that constant exactly (backend `lib/metric-registry.ts`) — the
 * fallback and the real fetch agree in the common case.
 */
export function useMetricRegistryKeys(): MetricKey[] {
  const [keys, setKeys] = useState<MetricKey[]>(METRIC_KEYS)

  useEffect(() => {
    let cancelled = false
    metricRegistryService
      .getRegistry()
      .then(entries => {
        if (cancelled || entries.length === 0) return
        setKeys(entries.map(e => e.key))
      })
      .catch(() => {
        // Keep the METRIC_KEYS fallback — a registry fetch failure must
        // never empty the picker.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return keys
}
