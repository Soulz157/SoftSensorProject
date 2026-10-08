import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * MODEL-SERVE-015-T06. The version list is the surface that makes an
 * augmented retrain's combined dataset reachable at all.
 *
 * The load-bearing cases here are not cosmetic:
 *  - The combined version must be LISTED. Before T06 it had no DatasetVersion
 *    row, and the detail sheet reads only `Dataset.currentArtifactId`, which
 *    a retrain deliberately never repoints — so nothing rendered it.
 *  - Each row's Explore must hand the host THAT ROW'S OWN artifactId. Passing
 *    the dataset's current artifact instead would silently show the
 *    pre-retrain data under the combined version's heading, which is worse
 *    than showing nothing: it would look like the augmentation had changed
 *    nothing. (The EDA itself renders once, full width, in the host dialog.)
 *  - A version with no artifact must not offer an Explore that 404s.
 */

const h = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('@/services/dataset-version', () => ({
  datasetVersionService: { list: h.list },
}))

import { DatasetVersionsList } from '../dataset-versions-list'

const AUGMENTED = {
  id: 'version-combined-1',
  datasetId: 'dataset-base',
  semanticVersion: '4.0.0+augmented',
  artifactId: 'artifact-combined-final',
  versionNumber: 4,
  status: 'DRAFT',
  checksum: 'combined-sha',
  qualityScore: null,
  rowCount: 12480,
  columnCount: 6,
  featureCount: 0,
  missingPct: 0,
  sizeBytes: 2048,
  durationMs: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  createdBy: 'operator',
}

const ORDINARY = {
  ...AUGMENTED,
  id: 'version-3',
  semanticVersion: '3.0.0',
  artifactId: 'artifact-saved-final',
  versionNumber: 3,
  status: 'ACTIVE',
  rowCount: 9000,
  featureCount: 6,
}

function renderList(selectedArtifactId: string | null = null) {
  const onExplore = vi.fn()
  render(
    <DatasetVersionsList
      datasetId="dataset-base"
      selectedArtifactId={selectedArtifactId}
      onExplore={onExplore}
    />,
  )
  return onExplore
}

beforeEach(() => {
  h.list.mockReset()
  h.list.mockResolvedValue({ data: [ORDINARY, AUGMENTED] })
})

describe('DatasetVersionsList', () => {
  it('lists the augmented version a retrain minted, newest first', async () => {
    renderList()

    expect(await screen.findByText('4.0.0+augmented')).toBeInTheDocument()
    expect(screen.getByText('3.0.0')).toBeInTheDocument()

    // Newest first — an augmented retrain's output is always the newest row.
    const rendered = screen.getAllByText(/^\d\.0\.0/).map(el => el.textContent)
    expect(rendered).toEqual(['4.0.0+augmented', '3.0.0'])
  })

  it("hands the host each row's OWN artifact and label on Explore", async () => {
    const user = userEvent.setup()
    const onExplore = renderList()

    const buttons = await screen.findAllByRole('button', { name: 'Explore' })
    expect(buttons).toHaveLength(2)
    // Newest first: the combined version is the first row.
    await user.click(buttons[0]!)
    expect(onExplore).toHaveBeenCalledWith(
      'artifact-combined-final',
      '4.0.0+augmented',
    )
    await user.click(buttons[1]!)
    expect(onExplore).toHaveBeenLastCalledWith('artifact-saved-final', '3.0.0')
  })

  it('marks the row the host is showing as Viewing instead of offering Explore', async () => {
    renderList('artifact-saved-final')

    expect(await screen.findByText('Viewing')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Explore' })).toHaveLength(1)
  })

  it('marks the combined version and leaves an unmeasured featureCount blank', async () => {
    renderList()

    expect(await screen.findByText('Combined')).toBeInTheDocument()
    // A combined version has no validation report, so a literal 0 would read
    // as a measured fact.
    expect(screen.getByText(/—\s*features/)).toBeInTheDocument()
    expect(screen.getByText('12,480 rows')).toBeInTheDocument()
  })

  it('offers no Explore for a version with no stored artifact', async () => {
    h.list.mockResolvedValue({ data: [{ ...AUGMENTED, artifactId: null }] })

    renderList()

    expect(await screen.findByText('No stored data')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Explore' }),
    ).not.toBeInTheDocument()
  })

  it('distinguishes a failed load from an empty list', async () => {
    h.list.mockRejectedValue(new Error('network down'))

    renderList()

    expect(await screen.findByText(/network down/)).toBeInTheDocument()
    expect(
      screen.queryByText('This dataset has no saved versions yet.'),
    ).not.toBeInTheDocument()
  })
})
