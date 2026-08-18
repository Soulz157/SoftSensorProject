import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { materializeBlocker } from '@/hooks/dataset/use-dataset-version-rows'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { PipelineConfig } from '@/lib/pipeline-config'

/**
 * The two pieces of F5 that decide whether a user sees REAL or INVENTED data.
 *
 * `materializeBlocker` picks the branch; `fetchVersionDataset` walks the pages.
 * A bug in either is silent — the wizard still renders a full, plausible table
 * — so both are pinned directly rather than left to an integration test that
 * would only notice if the numbers happened to look wrong.
 */

const replayable: PipelineConfig = {
  ...EMPTY_PIPELINE_CONFIG,
  baseTags: ['TI-101'],
  customDateRange: { from: '2026-06-22 00:00', to: '2026-06-22 01:00' },
  sourceFetchConfigs: { 'src-1': {} as never },
}

describe('materializeBlocker', () => {
  it('clears a recipe that has everything needed to re-fetch', () => {
    expect(materializeBlocker(replayable)).toBeNull()
  })

  it('blocks when the original tag list was never recorded', () => {
    // The legacy case `use-data-studio.ts` already warns about: the saved
    // `tags` are POST feature-engineering, so they cannot be re-fetched.
    expect(materializeBlocker({ ...replayable, baseTags: undefined })).toMatch(
      /original tag list/i,
    )
  })

  it('blocks when the fetch time range was never recorded', () => {
    expect(
      materializeBlocker({ ...replayable, customDateRange: null }),
    ).toMatch(/time range/i)
  })

  it('blocks when there is no source to read from', () => {
    expect(
      materializeBlocker({ ...replayable, sourceFetchConfigs: {} }),
    ).toMatch(/data source/i)
  })

  it('refuses a multi-source dataset rather than fetching one source of it', () => {
    // Materialising takes ONE sourceId. Without this the artifact would hold
    // only the first source's tags and page as though complete — a plausible
    // table with columns silently missing, which is the exact failure the
    // synthetic banner exists to prevent.
    expect(
      materializeBlocker({
        ...replayable,
        sourceFetchConfigs: { 'src-1': {} as never, 'src-2': {} as never },
      }),
    ).toMatch(/several data sources/i)
  })

  it('refuses a CSV source, whose rows only ever existed in the browser', () => {
    // Reached on the SAVE path now, so this has to be a stated reason rather
    // than a 400 from the connector: there is genuinely nothing server-side to
    // re-read, and the user did nothing wrong by uploading a file.
    expect(
      materializeBlocker({
        ...replayable,
        sourceFetchConfigs: { 'src-1': { type: 'csv' } as never },
      }),
    ).toMatch(/CSV rows are not stored/i)
  })

  it('refuses a SQL source, which cannot supply a table or timestamp column', () => {
    // `SQLConfig` holds connectionString + query only, so the recipe can never
    // produce the two fields `buildSourceBlock` requires.
    expect(
      materializeBlocker({
        ...replayable,
        sourceFetchConfigs: { 'src-1': { type: 'sql' } as never },
      }),
    ).toMatch(/'sql' data source/i)
  })

  it('clears a PI source, the one type the connector can re-read', () => {
    expect(
      materializeBlocker({
        ...replayable,
        sourceFetchConfigs: { 'src-1': { type: 'pi' } as never },
      }),
    ).toBeNull()
  })

  it('treats an empty baseTags array as missing, not as "no tags wanted"', () => {
    // `[]` would otherwise pass a plain presence check and materialise an
    // artifact with no columns at all.
    expect(materializeBlocker({ ...replayable, baseTags: [] })).toMatch(
      /original tag list/i,
    )
  })
})

// ── paging ────────────────────────────────────────────────────────────────

function row(i: number) {
  return {
    timestamp: `2026-06-22 00:${String(i).padStart(2, '0')}:00`,
    cells: { 'TI-101': { value: 70 + i, status: 'Good' as const } },
  }
}

/** Stub `fetchClient` so paging can be driven without a server. */
const pages = vi.hoisted(() => ({ handler: vi.fn() }))
vi.mock('@/lib/fetcher', () => ({
  fetchClient: (endpoint: string) => pages.handler(endpoint),
}))

describe('fetchVersionDataset', () => {
  beforeEach(() => pages.handler.mockReset())
  afterEach(() => vi.resetModules())

  async function subject() {
    const mod = await import('@/services/dataset-version')
    return mod.fetchVersionDataset
  }

  it('pages until it has the whole artifact', async () => {
    const total = 5
    pages.handler.mockImplementation((endpoint: string) => {
      const offset = Number(/offset=(\d+)/.exec(endpoint)?.[1] ?? 0)
      const limit = Number(/limit=(\d+)/.exec(endpoint)?.[1] ?? 2)
      const slice = Array.from({ length: total }, (_, i) => row(i)).slice(
        offset,
        offset + limit,
      )
      return Promise.resolve({
        data: { totalRowCount: total, offset, tags: ['TI-101'], rows: slice },
      })
    })

    const fetchVersionDataset = await subject()
    const dataset = await fetchVersionDataset('ds-1', 'v-1', { pageSize: 2 })

    expect(dataset.rows).toHaveLength(total)
    expect(dataset.tags).toEqual(['TI-101'])
    // 5 rows at 2 per page = 3 requests. Not 2, and not an infinite loop.
    expect(pages.handler).toHaveBeenCalledTimes(3)
    // Status must survive the trip — every cleaning operation reads it.
    expect(dataset.rows[0]!.cells['TI-101']!.status).toBe('Good')
  })

  it('reports progress against the artifact total, not the page', async () => {
    pages.handler.mockImplementation((endpoint: string) => {
      const offset = Number(/offset=(\d+)/.exec(endpoint)?.[1] ?? 0)
      return Promise.resolve({
        data: {
          totalRowCount: 4,
          offset,
          tags: ['TI-101'],
          rows: [row(offset), row(offset + 1)],
        },
      })
    })

    const seen: Array<[number, number]> = []
    const fetchVersionDataset = await subject()
    await fetchVersionDataset('ds-1', 'v-1', {
      pageSize: 2,
      onProgress: (loaded, total) => seen.push([loaded, total]),
    })

    expect(seen).toEqual([
      [2, 4],
      [4, 4],
    ])
  })

  it('stops on an empty page instead of spinning forever', async () => {
    // The artifact claims more rows than it returns — a truncated or shrinking
    // object. `offset < total` alone would never terminate.
    pages.handler.mockResolvedValue({
      data: { totalRowCount: 999, offset: 0, tags: ['TI-101'], rows: [] },
    })

    const fetchVersionDataset = await subject()
    const dataset = await fetchVersionDataset('ds-1', 'v-1', { pageSize: 10 })

    expect(dataset.rows).toEqual([])
    expect(pages.handler).toHaveBeenCalledTimes(1)
  })

  it('stops paging once the caller aborts', async () => {
    const signal = { aborted: false }
    pages.handler.mockImplementation((endpoint: string) => {
      const offset = Number(/offset=(\d+)/.exec(endpoint)?.[1] ?? 0)
      // Abort after the first page, as an unmount would.
      signal.aborted = true
      return Promise.resolve({
        data: {
          totalRowCount: 100,
          offset,
          tags: ['TI-101'],
          rows: [row(offset)],
        },
      })
    })

    const fetchVersionDataset = await subject()
    await fetchVersionDataset('ds-1', 'v-1', { pageSize: 1, signal })

    expect(pages.handler).toHaveBeenCalledTimes(1)
  })
})

// ── windowed reader (DS-LAKE-005B-B-T01/T04) ────────────────────────────────

describe('fetchVersionRowsPage', () => {
  beforeEach(() => pages.handler.mockReset())
  afterEach(() => vi.resetModules())

  async function subject() {
    const mod = await import('@/services/dataset-version')
    return mod.fetchVersionRowsPage
  }

  it('fetches exactly ONE page — no accumulation loop', async () => {
    pages.handler.mockImplementation((endpoint: string) => {
      const offset = Number(/offset=(\d+)/.exec(endpoint)?.[1] ?? 0)
      const limit = Number(/limit=(\d+)/.exec(endpoint)?.[1] ?? 0)
      return Promise.resolve({
        data: {
          totalRowCount: 500,
          offset,
          tags: ['TI-101'],
          rows: Array.from({ length: limit }, (_, i) => row(offset + i)),
        },
      })
    })

    const fetchVersionRowsPage = await subject()
    const result = await fetchVersionRowsPage('ds-1', 'v-1', {
      offset: 100,
      limit: 50,
    })

    // The one guarantee this function exists for: unlike fetchVersionDataset,
    // it must NOT keep paging until it has the whole artifact.
    expect(pages.handler).toHaveBeenCalledTimes(1)
    expect(result.page.rows).toHaveLength(50)
    expect(result.page.tags).toEqual(['TI-101'])
    expect(result.totalRowCount).toBe(500)
    expect(result.offset).toBe(100)
  })

  it('type gate: a bare Dataset cannot satisfy BoundedSample without brandBoundedSample()', () => {
    // V03-style compile-time proof. This is checked by `pnpm check-types`,
    // not by vitest's runtime assertions — if `brandBoundedSample()` were
    // removed or the brand's uniqueness broken, the line below would stop
    // erroring and `@ts-expect-error` itself would fail as an unused
    // directive, so this test's real assertion is that the build stays red
    // without going through the one legitimate constructor.
    function acceptsOnlyBoundedSample(
      page: import('@/lib/preprocessing').BoundedSample,
    ) {
      return page
    }
    function attemptWithBareDataset() {
      const bare: import('@/lib/preprocessing').Dataset = { tags: [], rows: [] }
      // @ts-expect-error — a bare Dataset is not a BoundedSample; only
      // brandBoundedSample() may mint one.
      return acceptsOnlyBoundedSample(bare)
    }
    void attemptWithBareDataset
    expect(true).toBe(true)
  })
})
