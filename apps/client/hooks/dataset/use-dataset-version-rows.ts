'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildRawDataset } from '@/lib/preprocessing'
import type { Dataset } from '@/lib/preprocessing'
import { MATERIALIZE_EPOCH } from '@/lib/pipeline-config'
import type { PipelineConfig } from '@/lib/pipeline-config'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import { toPiTime } from '@/lib/dataset-fetch'
import {
  datasetVersionService,
  fetchVersionDataset,
} from '@/services/dataset-version'
import type { SavedDataset } from '@/store/datasets'

/**
 * Load a saved dataset's rows, preferring REAL stored rows over synthetic ones.
 *
 * Three branches, in order. The ordering is the feature — getting it wrong
 * either shows an empty table or silently shows fabricated numbers:
 *
 *   1. `currentVersionId` set        -> page the committed artifact.
 *   2. no version, recipe replayable -> materialise V1 on demand, then page it.
 *   3. neither                       -> `buildRawDataset`, and SAY SO.
 *
 * Branch 2 is what makes this work at all today: every existing Dataset row has
 * `currentVersionId = null`, so shipping only branch 1 would show no rows for
 * every dataset that already exists — strictly worse than what it replaces.
 *
 * Branch 3 exists because legacy recipes predate `baseTags` and
 * `customDateRange` being persisted, so there is genuinely nothing to re-fetch
 * from. It reports `source: 'synthetic'` with a reason, and the caller MUST
 * surface that: quietly presenting generated readings as the user's own data is
 * the exact failure this slice removes, and it is undetectable from the table.
 */

export type RowSource = 'stored' | 'synthetic'

export type VersionRowsStatus =
  | 'idle'
  | 'loading'
  | 'materializing'
  | 'done'
  | 'error'

export interface VersionRowsState {
  dataset: Dataset | null
  source: RowSource | null
  status: VersionRowsStatus
  /** Rows loaded so far, and the artifact total — for the progress UI. */
  loaded: number
  total: number
  error: string | null
  /** Why branch 3 was taken. Null unless `source === 'synthetic'`. */
  syntheticReason: string | null
}

const IDLE: VersionRowsState = {
  dataset: null,
  source: null,
  status: 'idle',
  loaded: 0,
  total: 0,
  error: null,
  syntheticReason: null,
}

/**
 * Can this recipe be re-fetched from its source? Returns the reason it cannot,
 * or null when it can.
 *
 * Both fields checked here were added to `PipelineConfig` after the first
 * datasets were saved, so "missing" means "old recipe", not "corrupt" — the
 * messages are worded for a user, not a developer.
 */
export function materializeBlocker(config: PipelineConfig): string | null {
  if (!config.baseTags?.length) {
    return 'This dataset was saved before its original tag list was recorded.'
  }
  if (!config.customDateRange?.from || !config.customDateRange?.to) {
    return 'This dataset was saved before its fetch time range was recorded.'
  }
  const sources = Object.keys(config.sourceFetchConfigs ?? {})
  if (sources.length === 0) {
    return 'This dataset has no saved data source to re-read.'
  }
  if (sources.length > 1) {
    // Materialising takes ONE sourceId, so a multi-source dataset would come
    // back holding only the first source's tags — a short but entirely
    // plausible-looking table, with the missing columns invisible. Refusing is
    // the safe answer until the endpoint accepts several sources.
    return 'This dataset combines several data sources, which cannot be re-fetched automatically yet.'
  }
  // Only PI/AVEVA can be re-read server-side today. Screening the others HERE
  // rather than letting the request 400 matters because this now runs on the
  // SAVE path: a CSV's rows exist only in the browser, so there is genuinely
  // nothing to re-fetch, and a SQL recipe cannot supply the table + timestamp
  // column the connector requires (`SQLConfig` holds neither). Without this the
  // user would meet a save-time error for an entirely normal action.
  const type = config.sourceFetchConfigs[sources[0]!]?.type
  if (type === 'csv') {
    return 'Uploaded CSV rows are not stored on the server, so they cannot be re-read.'
  }
  if (type && type !== 'pi') {
    return `A '${type}' data source cannot be re-fetched automatically yet.`
  }
  return null
}

export function useDatasetVersionRows(
  dataset: SavedDataset | null,
  options: {
    enabled?: boolean
    prefer?: 'raw' | 'current'
    materialize?: boolean
  } = {},
): VersionRowsState & { reload: () => void } {
  const enabled = options.enabled ?? true
  // Whether branch 2 may CREATE an artifact. Read-only screens must pass false:
  // materialising runs a full source fetch and writes a Parquet object —
  // minutes of work, which is not something merely opening a tab should do.
  // With false, branch 2 falls through to synthetic-with-a-reason.
  //
  // Since DS-LAKE-004 this creates a BRONZE DatasetArtifact, not a
  // DatasetVersion, and moves `currentArtifactId` rather than
  // `currentVersionId`. That is what makes materialising on Edit-open
  // legitimate again: the invariant is "no Dataset VERSION outside Save", and
  // an artifact is a pipeline stage, not a save. Forcing `materialize: false`
  // here instead would have been the wrong fix — every legacy dataset has
  // `currentVersionId = null`, so they would all have fallen through to
  // synthetic rows, trading an invariant breach for a data-fidelity one.
  const materialize = options.materialize ?? true
  // Which artifact to hydrate from. `'raw'` for anything that REPLAYS the saved
  // recipe — `currentVersionId` points at the newest version, which after a
  // cleaning job is a CLEAN artifact, and running the recipe over that would
  // apply every operation twice. `'current'` for showing the dataset as it
  // stands, already processed.
  const prefer = options.prefer ?? 'raw'
  const [state, setState] = useState<VersionRowsState>(IDLE)
  const [nonce, setNonce] = useState(0)
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })

  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    // Disabled or nothing selected: do NOT write state here. The returned value
    // is derived below instead, so there is no render-then-reset round trip and
    // nothing to keep in sync.
    if (!enabled || !dataset) return

    // A fresh run supersedes any in-flight one: the older loop sees this flag
    // between pages and stops writing state.
    abortRef.current.aborted = true
    const signal = { aborted: false }
    abortRef.current = signal

    const config = dataset.pipelineConfig

    // NOT named `use*`: it is a plain closure, and the `use` prefix would make
    // the linter police it as a React hook.
    const fallBackToSynthetic = (reason: string) => {
      if (signal.aborted) return
      setState({
        dataset: buildRawDataset(
          config.baseTags ?? dataset.tags,
          PERIOD_TO_RANGE[config.timeRange],
          MATERIALIZE_EPOCH,
          config.tagConstants,
        ),
        source: 'synthetic',
        status: 'done',
        loaded: 0,
        total: 0,
        error: null,
        syntheticReason: reason,
      })
    }

    const page = async (versionId: string) => {
      const rows = await fetchVersionDataset(dataset.id, versionId, {
        signal,
        onProgress: (loaded, total) =>
          setState(prev =>
            signal.aborted ? prev : { ...prev, loaded, total },
          ),
      })
      if (signal.aborted) return
      setState({
        dataset: rows,
        source: 'stored',
        status: 'done',
        loaded: rows.rows.length,
        total: rows.rows.length,
        error: null,
        syntheticReason: null,
      })
    }

    /**
     * The artifact to read. For recipe replay this must be the RAW version,
     * not the newest one — see the `prefer` note above.
     */
    const resolveVersionId = async (): Promise<string | null> => {
      // DS-LAKE-004: new datasets carry `currentArtifactId` and get no
      // `currentVersionId` until Save Dataset. The bronze artifact IS the raw
      // one, so there is no lineage to walk and no version list to fetch —
      // which also removes the extra round trip the `prefer: 'raw'` path costs.
      if (dataset.currentArtifactId) return dataset.currentArtifactId

      if (!dataset.currentVersionId) return null
      if (prefer === 'current') return dataset.currentVersionId

      const versions = await datasetVersionService.list(dataset.id)
      const raw = versions.data
        .filter(v => v.stage === 'RAW')
        .sort((a, b) => a.versionNumber - b.versionNumber)[0]
      // No RAW version means the lineage predates this scheme; the current one
      // is the only thing to read, and re-applying the recipe is still closer
      // to right than showing nothing.
      return raw?.id ?? dataset.currentVersionId
    }

    const run = async () => {
      // ── 1. a committed artifact exists ──────────────────────────────────
      if (dataset.currentArtifactId || dataset.currentVersionId) {
        setState({ ...IDLE, status: 'loading' })
        const versionId = await resolveVersionId()
        if (signal.aborted || !versionId) return
        await page(versionId)
        return
      }

      // ── 2. no version yet — materialise V1 from the saved recipe ────────
      if (!materialize) {
        fallBackToSynthetic(
          'This dataset has no stored rows yet. Open it in Data Studio to fetch them from the source.',
        )
        return
      }

      const blocker = materializeBlocker(config)
      if (blocker) {
        fallBackToSynthetic(blocker)
        return
      }

      setState({ ...IDLE, status: 'materializing' })
      const sourceId = Object.keys(config.sourceFetchConfigs)[0]!
      const created = await datasetVersionService.createRaw(dataset.id, {
        sourceId,
        tags: config.baseTags!,
        startTime: toPiTime(config.customDateRange!.from),
        endTime: toPiTime(config.customDateRange!.to),
      })
      if (signal.aborted) return
      await page(created.data.id)
    }

    run().catch((err: unknown) => {
      if (signal.aborted) return
      // ── 3. source gone, unreachable, or the fetch failed ────────────────
      // Showing something beats showing nothing, but never silently: the
      // banner carries this reason verbatim.
      fallBackToSynthetic(
        err instanceof Error
          ? `Could not load stored rows: ${err.message}`
          : 'Could not load stored rows from the server.',
      )
    })

    return () => {
      signal.aborted = true
    }
  }, [dataset, enabled, prefer, materialize, nonce])

  // Derived, not stored: when the hook is disabled or has no dataset it reports
  // IDLE regardless of what the last enabled run left behind. That also stops a
  // previous dataset's rows leaking into the next selection for one render.
  return { ...(enabled && dataset ? state : IDLE), reload }
}
