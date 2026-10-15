import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EquipmentAlertChip } from '@/lib/overview-status'
import type { NodeStatus } from '@/store/status-colors'
import { PlantNameBadge } from '../tower'

function renderBadge(status: NodeStatus, chip: EquipmentAlertChip | null) {
  return render(
    <svg>
      <PlantNameBadge
        cx={200}
        cy={150}
        status={status}
        chip={chip}
        name="Boiler Plant A"
        isDark
      />
    </svg>,
  )
}

describe('PlantNameBadge (MODEL-SERVE-033)', () => {
  it('all green: no count and no per-equipment dots, only the check icon', () => {
    const { container, queryByTestId } = renderBadge('normal', null)
    expect(queryByTestId('plant-badge-count')).toBeNull()
    expect(
      container.querySelector('[data-status-icon="normal"]'),
    ).not.toBeNull()
    // the badge's own status dot is the only circle left
    expect(container.querySelectorAll('circle[r="5"]')).toHaveLength(1)
    expect(container.querySelectorAll('circle[r="2.5"]')).toHaveLength(0)
  })

  it('some red: the alert icon and the count "2/8" in mono', () => {
    const { container, getByTestId } = renderBadge('alarm', {
      abnormal: 2,
      total: 8,
    })
    const count = getByTestId('plant-badge-count')
    expect(count.textContent).toBe('2/8')
    expect(count.getAttribute('font-family')).toMatch(/^Geist Mono/)
    expect(
      container.querySelector('[data-status-icon="abnormal"]'),
    ).not.toBeNull()
  })

  it('plant red with no red equipment: alert icon, no "0/n" count', () => {
    const { container, queryByTestId } = renderBadge('alarm', null)
    expect(queryByTestId('plant-badge-count')).toBeNull()
    expect(
      container.querySelector('[data-status-icon="abnormal"]'),
    ).not.toBeNull()
  })

  it('the count widens the badge instead of overlapping the name', () => {
    const plain = renderBadge('alarm', null).container.querySelector('rect')
    const counted = renderBadge('alarm', {
      abnormal: 12,
      total: 30,
    }).container.querySelector('rect')
    const w = (el: Element | null) => Number(el?.getAttribute('width'))
    expect(w(counted)).toBeGreaterThan(w(plain))
  })
})
