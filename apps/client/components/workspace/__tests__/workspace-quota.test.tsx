import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Cpu } from 'lucide-react'
import { CountRow, WorkspaceQuota } from '../workspace-quota'
import type { WorkspaceQuota as Quota } from '@/types'

const item = (
  current: number,
  limit: number | null,
  source: 'admin' | 'plan' | 'none',
) => ({
  current,
  limit,
  full: limit !== null && current >= limit,
  over: limit !== null && current > limit,
  source,
})

const owner = { firstName: 'Ann', lastName: 'Lee' }

describe('WorkspaceQuota (MODEL-SERVE-040)', () => {
  it('shows the owner and each count against its cap, with its source', () => {
    const quota: Quota = {
      models: item(2, 5, 'plan'),
      members: item(1, 3, 'admin'),
    }
    render(<WorkspaceQuota quota={quota} owner={owner} />)

    expect(screen.getByText('Ann Lee')).toBeInTheDocument()
    expect(screen.getByText('2 / 5')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByText("From owner's subscription")).toBeInTheDocument()
    expect(screen.getByText('Set by admin')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'Models used' }),
    ).toBeInTheDocument()
  })

  it('never names the plan', () => {
    const quota: Quota = {
      models: item(2, 5, 'plan'),
      members: item(1, 3, 'plan'),
    }
    render(<WorkspaceQuota quota={quota} owner={owner} />)
    expect(screen.queryByText(/FREE|STANDARD|PRO|ENTERPRISE/)).toBeNull()
  })

  it('says "At the limit" when full and "Over" when above, in plain text', () => {
    const quota: Quota = {
      models: item(5, 5, 'plan'),
      members: item(4, 3, 'admin'),
    }
    render(<WorkspaceQuota quota={quota} owner={owner} />)
    expect(
      screen.getByText("At the limit · From owner's subscription"),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Over the limit · Set by admin'),
    ).toBeInTheDocument()
  })

  it('no limit shows the bare count and no bar', () => {
    const quota: Quota = {
      models: item(40, null, 'none'),
      members: item(7, null, 'none'),
    }
    render(<WorkspaceQuota quota={quota} owner={owner} />)
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getAllByText('No limit')).toHaveLength(2)
  })

  it('falls back to Unknown for an owner with no name and says so without quota', () => {
    render(
      <WorkspaceQuota
        quota={undefined}
        owner={{ firstName: null, lastName: null }}
      />,
    )
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Quota unavailable.')).toBeInTheDocument()
  })

  it('puts a plain count (Equipment) between the owner and the quota rows', () => {
    const quota: Quota = {
      models: item(2, 5, 'plan'),
      members: item(1, 3, 'plan'),
    }
    render(
      <WorkspaceQuota quota={quota} owner={owner}>
        <CountRow label="Equipment" icon={Cpu} value={12} />
      </WorkspaceQuota>,
    )
    const text = document.body.textContent ?? ''
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(text.indexOf('Ann Lee')).toBeLessThan(text.indexOf('Equipment'))
    expect(text.indexOf('Equipment')).toBeLessThan(text.indexOf('Models'))
    expect(text.indexOf('Models')).toBeLessThan(text.indexOf('Members'))
    // The count has no cap, so only the two quota rows draw a bar.
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
  })

  it('shows a busy skeleton while loading', () => {
    const { container } = render(
      <WorkspaceQuota quota={undefined} owner={undefined} loading />,
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/Owner/)).toBeNull()
  })
})
