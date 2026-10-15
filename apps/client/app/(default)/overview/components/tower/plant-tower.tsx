'use client'

import { useState } from 'react'
import { DEFAULT_SQUASH, GRID, U } from '@/lib/iso-tower'
import type { EquipmentAlertChip } from '@/lib/overview-status'
import { type NodeStatus } from '@/store/status-colors'
import { PlantScene } from './plant-scene'
import { COLOR_HEX, DEFAULT_ACCENT_HEX } from './tower-skin'

interface PlantTowerProps {
  cx: number
  cy: number
  equipmentCount: number
  status: NodeStatus
  /** Abnormal / total equipment, for the accessible name; null when all Normal. */
  chip?: EquipmentAlertChip | null
  workspaceColor: string
  name: string
  selected: boolean
  squash?: number
  lod?: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
  onDoubleClick: () => void
}

/**
 * One plant on the Overview map: the scene, its focus / selected rings, and its
 * events. The name badge is drawn by the map in its own top layer
 * (`PlantNameBadge`), so towers never cover it.
 */
export function PlantTower({
  cx,
  cy,
  equipmentCount,
  status,
  chip = null,
  workspaceColor,
  name,
  selected,
  squash = DEFAULT_SQUASH,
  lod = true,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onDoubleClick,
}: PlantTowerProps) {
  const [isFocused, setIsFocused] = useState(false)

  const accentHex = COLOR_HEX[workspaceColor] ?? DEFAULT_ACCENT_HEX
  const BASE_HALF_W = 2 * GRID * U
  const BASE_HALF_H = 2 * GRID * (U * squash)

  return (
    <g
      className="cursor-pointer motion-safe:transition-transform motion-safe:hover:-translate-y-1"
      tabIndex={0}
      role="button"
      aria-label={`${name} plant — status: ${status}, ${equipmentCount} nodes${
        chip ? `, ${chip.abnormal} of ${chip.total} equipment abnormal` : ''
      }`}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onDoubleClick={e => {
        e.preventDefault()
        onDoubleClick()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {isFocused && (
        <ellipse
          cx={cx}
          cy={cy + 8}
          rx={BASE_HALF_W + 16}
          ry={BASE_HALF_H + 13}
          fill="none"
          stroke={accentHex}
          strokeWidth={2}
          opacity={0.9}
        />
      )}
      {selected && (
        <ellipse
          cx={cx}
          cy={cy + 8}
          rx={BASE_HALF_W + 9}
          ry={BASE_HALF_H + 8}
          fill="none"
          stroke={accentHex}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.75}
        />
      )}

      <PlantScene
        cx={cx}
        cy={cy}
        squash={squash}
        equipmentCount={equipmentCount}
        status={status}
        lod={lod}
      />
    </g>
  )
}
