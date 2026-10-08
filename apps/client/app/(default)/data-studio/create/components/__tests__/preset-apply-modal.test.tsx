import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { PresetApplyManager } from '../preset-apply-modal'
import { dwWorkspaceIdAtom } from '@/store/dataset-studio'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import type {
  PresetDocument,
  PresetSummary,
  SdtaConfig,
} from '@/lib/feature-preset'

/**
 * The sheet, driven as a component rather than through its lib.
 *
 * `lib/__tests__/feature-preset.test.ts` already proves `compareTags` refuses a
 * tag whose row is in error. That says nothing about whether the BUTTON obeys
 * it — the dialog this replaces had plausible-looking comparison logic and
 * still enabled Apply, because it was handed `rows.map(r => r.tagName)` and so
 * never saw a status. What is pinned here is the wiring and the mount.
 */

const PRESETS: PresetSummary[] = [
  {
    id: 'row-1',
    presetId: 'u-101-no1',
    unit: 'U-101',
    configNo: 1,
    name: 'U-101 No.1 — U101FBP.lab',
    samplingPoint: 'RU-101 Overhead',
    targetY: 'U101FBP.lab',
    objectKey: 'feature-presets/ws-1/imp-1/u-101-no1.json',
    equationCount: 1,
    rawTagCount: 0,
    requiredBaseTags: ['QQ001A2.PV', 'GG001.PV'],
    incomplete: false,
  },
  {
    id: 'row-2',
    presetId: 'u-101-no2',
    unit: 'U-101',
    configNo: 2,
    name: 'U-101 No.2 — U101IBP.lab',
    samplingPoint: null,
    targetY: 'U101IBP.lab',
    objectKey: 'feature-presets/ws-1/imp-1/u-101-no2.json',
    equationCount: 0,
    rawTagCount: 0,
    requiredBaseTags: [],
    incomplete: true,
  },
]

const DOCUMENT: PresetDocument = {
  schema_version: 1,
  preset_id: 'u-101-no1',
  unit: 'U-101',
  config_no: 1,
  name: 'U-101 No.1 — U101FBP.lab',
  plant: 'ACME HOT',
  sampling_point: 'RU-101 Overhead',
  target_y: 'U101FBP.lab',
  features: [
    {
      type: 'equation',
      name: 'Spgr_in_feed',
      formula: '(QQ001A2.PV*GG001.PV)/GG001.PV',
      description: 'Spgr in feed',
      range: '-',
      range_parsed: null,
      relation: '+',
      required_base_tags: ['QQ001A2.PV', 'GG001.PV'],
      parse_warnings: [],
    },
  ],
  required_base_tags: ['GG001.PV', 'QQ001A2.PV'],
  incomplete: false,
}

const loadDocument = vi.fn()
const loadSdta = vi.fn()
const importWorkbook = vi.fn()

/** Mutable so individual tests can turn the SD&TA card on. Reset in beforeEach. */
let mockCurrentImport = {
  id: 'imp-1',
  fileName: 'templates.xlsx',
  sheetCount: 2,
  skippedSheets: ['META'],
  sdtaKey: null as string | null,
  createdAt: '2026-08-05T00:00:00Z',
}

vi.mock('@/hooks/dataset/use-feature-presets', () => ({
  useFeaturePresets: () => ({
    presets: PRESETS,
    currentImport: mockCurrentImport,
    loading: false,
    importing: false,
    error: null,
    refetch: vi.fn(),
    importWorkbook,
    loadDocument,
    loadSdta,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

function row(
  tagName: string,
  status: 'good' | 'error' = 'good',
  errorReason?: string,
): DatasetTagRow {
  return {
    id: `src::${tagName}`,
    tagName,
    originalName: tagName,
    dataSource: 'PI',
    status: status === 'error' ? 'bad' : 'good',
    errorReason,
    sourceId: 'src-1',
  }
}

function renderSheet(
  rows: DatasetTagRow[],
  onApply = vi.fn(),
  onApplySdta = vi.fn(),
) {
  const store = createStore()
  store.set(dwWorkspaceIdAtom, 'ws-1')
  render(
    <Provider store={store}>
      <PresetApplyManager
        rows={rows}
        onApplyPreset={onApply}
        onApplySdta={onApplySdta}
      />
    </Provider>,
  )
  return { onApply, onApplySdta }
}

const openSheet = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /apply feature preset/i }))

describe('PresetApplyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadDocument.mockResolvedValue(DOCUMENT)
    mockCurrentImport = { ...mockCurrentImport, sdtaKey: null }
  })

  it('renders its trigger without opening the sheet', () => {
    renderSheet([row('QQ001A2.PV'), row('GG001.PV')])

    expect(
      screen.getByRole('button', { name: /apply feature preset/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/feature preset manager/i),
    ).not.toBeInTheDocument()
  })

  it('opens to the manager with the imported workbook named', async () => {
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV'), row('GG001.PV')])

    await openSheet(user)

    expect(await screen.findByText(/feature preset manager/i)).toBeVisible()
    expect(screen.getByText('templates.xlsx')).toBeVisible()
  })

  it('names the sheets it skipped rather than dropping them silently', async () => {
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV')])

    await openSheet(user)

    expect(await screen.findByText(/skipped/i)).toHaveTextContent('META')
  })

  it('keeps Apply disabled until a preset is chosen', async () => {
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV'), row('GG001.PV')])

    await openSheet(user)

    expect(
      await screen.findByRole('button', { name: /apply mapping/i }),
    ).toBeDisabled()
  })

  it('asks for a preset before showing any verification', async () => {
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV'), row('GG001.PV')])

    await openSheet(user)

    expect(
      await screen.findByText(/select a preset to check its required tags/i),
    ).toBeVisible()
  })

  it('shows both entry points: browse an existing import and upload a new one', async () => {
    // The user asked for "upload OR choose", and the dialog being replaced had
    // both. Losing the browse path would silently halve the feature.
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV')])

    await openSheet(user)

    expect(await screen.findByText(/upload workbook/i)).toBeVisible()
    await waitFor(() => expect(screen.getByText(/select unit/i)).toBeVisible())
    expect(screen.getByText(/select no/i)).toBeVisible()
  })

  it('does not evaluate anything on open — no rows are needed to browse', async () => {
    const user = userEvent.setup()
    renderSheet([])

    await openSheet(user)

    expect(await screen.findByText(/feature preset manager/i)).toBeVisible()
    expect(loadDocument).not.toHaveBeenCalled()
  })
})

const SDTA: SdtaConfig = {
  ranges: [{ from: '2022-09-01T00:00:00Z', to: '2023-01-01T00:00:00Z' }],
  conditions: [
    { tag: 'GG203.PV', op: '<', value: 1700 },
    { tag: 'YY107.CPV', op: '<', value: 100 },
  ],
}

describe('PresetApplyManager — SD&TA cut config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadDocument.mockResolvedValue(DOCUMENT)
    mockCurrentImport = {
      ...mockCurrentImport,
      sdtaKey: 'feature-presets/ws-1/imp-1/sdta.json',
    }
  })

  it('does not show the card when the import has no SD&TA sheet', async () => {
    mockCurrentImport = { ...mockCurrentImport, sdtaKey: null }
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV')])

    await openSheet(user)

    expect(await screen.findByText(/feature preset manager/i)).toBeVisible()
    expect(
      screen.queryByText(/shutdown \/ turnaround/i),
    ).not.toBeInTheDocument()
  })

  it('shows an opt-in card, independent of any preset selection', async () => {
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV')])

    await openSheet(user)

    expect(await screen.findByText(/shutdown \/ turnaround/i)).toBeVisible()
    expect(
      screen.getByRole('button', { name: /load cut config/i }),
    ).toBeVisible()
  })

  it('loads the config on click and shows its counts', async () => {
    loadSdta.mockResolvedValue(SDTA)
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV')])

    await openSheet(user)
    await user.click(screen.getByRole('button', { name: /load cut config/i }))

    expect(await screen.findByText('1')).toBeVisible() // Windows
    expect(screen.getByText('2')).toBeVisible() // Conditions
    expect(loadSdta).toHaveBeenCalledWith('imp-1')
  })

  it('hands the loaded config to onApplySdta with no preset selected, and marks it staged', async () => {
    loadSdta.mockResolvedValue(SDTA)
    const user = userEvent.setup()
    const { onApplySdta } = renderSheet([row('QQ001A2.PV')])

    await openSheet(user)
    await user.click(screen.getByRole('button', { name: /load cut config/i }))
    await user.click(
      await screen.findByRole('button', { name: /stage cut config/i }),
    )

    // No unit/preset was selected above — `summary` is null, and the modal
    // falls back to the import's own file name (DS-LAKE-013).
    expect(onApplySdta).toHaveBeenCalledWith(SDTA, null, 'templates.xlsx')
    expect(
      screen.getByRole('button', { name: /staged.*step 3\.2/i }),
    ).toBeDisabled()
  })

  it('surfaces a failed load rather than a silent empty card', async () => {
    loadSdta.mockRejectedValue(new Error('Object not found'))
    const user = userEvent.setup()
    renderSheet([row('QQ001A2.PV')])

    await openSheet(user)
    await user.click(screen.getByRole('button', { name: /load cut config/i }))

    expect(await screen.findByText(/object not found/i)).toBeVisible()
  })
})
