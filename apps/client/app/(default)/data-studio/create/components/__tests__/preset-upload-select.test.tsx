import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PresetUploadSelect } from '../preset-upload-select'
import type { PresetUpload } from '@/services/feature-preset'

function upload(over: Partial<PresetUpload> & { id: string }): PresetUpload {
  return {
    fileName: `${over.id}.xlsx`,
    sheetCount: 3,
    presetCount: 7,
    hasSdta: false,
    createdAt: '2026-10-12T07:05:00Z',
    isLatest: false,
    ...over,
  }
}

const UPLOADS: PresetUpload[] = [
  upload({ id: 'mine-new', isLatest: true }),
  upload({ id: 'mine-old', presetCount: 1, hasSdta: true }),
]

const trigger = () => screen.getByRole('combobox', { name: 'Your workbook' })

describe('PresetUploadSelect', () => {
  it('renders nothing when the user has no uploads here', () => {
    const { container } = render(
      <PresetUploadSelect uploads={[]} selectedId={null} onSelect={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('is one compact control showing the selected file and its Latest badge', () => {
    render(
      <PresetUploadSelect
        uploads={UPLOADS}
        selectedId="mine-new"
        onSelect={vi.fn()}
      />,
    )
    expect(within(trigger()).getByText('mine-new.xlsx')).toBeInTheDocument()
    expect(within(trigger()).getByText('Latest')).toBeInTheDocument()
    // The date stays in the open list, not the trigger.
    expect(within(trigger()).queryByText(/presets/)).toBeNull()
  })

  it('no Latest badge in the trigger when an older upload is chosen', () => {
    render(
      <PresetUploadSelect
        uploads={UPLOADS}
        selectedId="mine-old"
        onSelect={vi.fn()}
      />,
    )
    expect(within(trigger()).getByText('mine-old.xlsx')).toBeInTheDocument()
    expect(within(trigger()).queryByText('Latest')).toBeNull()
  })

  it('lists every upload with its date and counts, Latest on the newest only', async () => {
    const user = userEvent.setup()
    render(
      <PresetUploadSelect
        uploads={UPLOADS}
        selectedId="mine-new"
        onSelect={vi.fn()}
      />,
    )
    await user.click(trigger())

    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(within(options[0]!).getByText('Latest')).toBeInTheDocument()
    expect(within(options[1]!).queryByText('Latest')).toBeNull()
    expect(
      within(options[1]!).getByText(/1 preset · SD&TA/),
    ).toBeInTheDocument()
  })

  it('choosing another upload reports its id', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <PresetUploadSelect
        uploads={UPLOADS}
        selectedId="mine-new"
        onSelect={onSelect}
      />,
    )
    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: /mine-old/ }))
    expect(onSelect).toHaveBeenCalledWith('mine-old')
  })

  it("shows a prompt when the screen holds a workbook that is not the user's", () => {
    render(
      <PresetUploadSelect
        uploads={UPLOADS}
        selectedId="teammate-upload"
        onSelect={vi.fn()}
      />,
    )
    expect(
      within(trigger()).getByText(/choose one of your uploads/i),
    ).toBeInTheDocument()
  })

  it('is disabled while presets are loading', () => {
    render(
      <PresetUploadSelect
        uploads={UPLOADS}
        selectedId="mine-new"
        onSelect={vi.fn()}
        disabled
      />,
    )
    expect(trigger()).toBeDisabled()
  })
})
