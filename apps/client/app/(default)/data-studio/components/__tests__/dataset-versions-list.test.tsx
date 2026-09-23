import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * MODEL-SERVE-015-T06. The version list is the surface that makes an
 * augmented retrain's combined dataset reachable at all.
 *
 * The load-bearing cases here are not cosmetic:
 *  - The combined version must be LISTED. Before T06 it had no DatasetVersion
 *    row, and the detail sheet reads only `Dataset.currentArtifactId`, which
 *    a retrain deliberately never repoints — so nothing rendered it.
 *  - Each row's EDA panel must receive THAT ROW'S OWN artifactId. Passing the
 *    dataset's current artifact instead would silently show the pre-retrain
 *    data under the combined version's heading, which is worse than showing
 *    nothing: it would look like the augmentation had changed nothing.
 *  - A version with no artifact must not offer an explore panel that 404s.
 */

const h = vi.hoisted(() => ({
  edaProps: [] as Array<Record<string, unknown>>,
  list: vi.fn(),
}))

vi.mock('@/app/(default)/models/[id]/components/retrain-version-eda', () => ({
  RetrainVersionEda: (props: Record<string, unknown>) => {
    h.edaProps.push(props)
    return <div data-testid="eda" data-artifact={String(props.artifactId)} />
  },
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

beforeEach(() => {
  h.edaProps.length = 0
  h.list.mockReset()
  h.list.mockResolvedValue({ data: [ORDINARY, AUGMENTED] })
})

describe('DatasetVersionsList', () => {
  it('lists the augmented version a retrain minted, newest first', async () => {
    render(<DatasetVersionsList datasetId="dataset-base" tags={['TI-101']} />)

    expect(await screen.findByText('4.0.0+augmented')).toBeInTheDocument()
    expect(screen.getByText('3.0.0')).toBeInTheDocument()

    // Newest first — an augmented retrain's output is always the newest row.
    const rendered = screen.getAllByText(/^\d\.0\.0/).map(el => el.textContent)
    expect(rendered).toEqual(['4.0.0+augmented', '3.0.0'])
  })

  it("gives each row an EDA panel bound to that row's own artifact", async () => {
    render(<DatasetVersionsList datasetId="dataset-base" tags={['TI-101']} />)

    await waitFor(() => expect(h.edaProps).toHaveLength(2))
    const artifacts = h.edaProps.map(p => p.artifactId)
    expect(artifacts).toContain('artifact-combined-final')
    expect(artifacts).toContain('artifact-saved-final')
    // Tags come off the dataset: a version row carries none.
    expect(h.edaProps.map(p => p.tags)).toEqual([['TI-101'], ['TI-101']])
  })

  it('marks the combined version and leaves an unmeasured featureCount blank', async () => {
    render(<DatasetVersionsList datasetId="dataset-base" tags={[]} />)

    expect(await screen.findByText('Combined')).toBeInTheDocument()
    // A combined version has no validation report, so a literal 0 would read
    // as a measured fact.
    expect(screen.getByText(/—\s*features/)).toBeInTheDocument()
    expect(screen.getByText('12,480 rows')).toBeInTheDocument()
  })

  it('offers no explore panel for a version with no stored artifact', async () => {
    h.list.mockResolvedValue({ data: [{ ...AUGMENTED, artifactId: null }] })

    render(<DatasetVersionsList datasetId="dataset-base" tags={[]} />)

    expect(await screen.findByText('No stored data')).toBeInTheDocument()
    expect(h.edaProps).toHaveLength(0)
  })

  it('distinguishes a failed load from an empty list', async () => {
    h.list.mockRejectedValue(new Error('network down'))

    render(<DatasetVersionsList datasetId="dataset-base" tags={[]} />)

    expect(await screen.findByText(/network down/)).toBeInTheDocument()
    expect(
      screen.queryByText('This dataset has no saved versions yet.'),
    ).not.toBeInTheDocument()
  })
})
