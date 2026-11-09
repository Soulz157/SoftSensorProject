import { CheckCircle2, AlertCircle } from 'lucide-react'
import { DEFAULT_SQUASH, GRID, SLAB, U } from '@/lib/iso-tower'
import {
  toBinaryStatus,
  BINARY_STATUS_META,
  type EquipmentAlertChip,
} from '@/lib/overview-status'
import { type NodeStatus } from '@/store/status-colors'
import { skinFor } from './tower-skin'

const BADGE_PAD = 8
const BADGE_H = 28
const GAP = 7
const COUNT_GAP = 4
const STATUS_R = 5
const ICON = 12
const CHAR_W = 8.2 // Geist Sans 13px/600 ≈ 8.2px ต่อตัวอักษร
const MONO_CHAR_W = 7.2 // Geist Mono 12px ≈ 0.6em ต่อตัวอักษร

/** Same reds as the map header's Abnormal count (overview-map.tsx). */
const COUNT_FILL = { dark: '#f87171', light: '#dc2626' }

interface PlantNameBadgeProps {
  cx: number
  cy: number
  status: NodeStatus
  /** Abnormal / total equipment; null when every equipment is Normal. */
  chip: EquipmentAlertChip | null
  name: string
  isDark: boolean
  squash?: number
}

/**
 * The plant's name tag under its tower: status dot, name, status icon, and —
 * only when some equipment is Abnormal — the count `2/8` beside the icon.
 *
 * MODEL-SERVE-033. This replaced a strip of one coloured dot per equipment:
 * an all-green plant now shows no per-equipment marks at all, and a red one
 * says how many in text (DESIGN.md: status colour is never used alone).
 * A plant can be Abnormal with no Abnormal equipment (a model with no
 * equipment failed); it then shows the alert icon without a count.
 */
export function PlantNameBadge({
  cx,
  cy,
  status,
  chip,
  name,
  isDark,
  squash = DEFAULT_SQUASH,
}: PlantNameBadgeProps) {
  const bin = toBinaryStatus(status)
  const statusColor = BINARY_STATUS_META[bin].color
  const StatusIcon = bin === 'abnormal' ? AlertCircle : CheckCircle2
  const sk = skinFor(status)

  const displayName = name.length > 12 ? `${name.slice(0, 11)}…` : name
  const nameW = Math.max(24, displayName.length * CHAR_W)

  const countText = chip ? `${chip.abnormal}/${chip.total}` : null
  const countW = countText ? countText.length * MONO_CHAR_W : 0

  const badgeW =
    BADGE_PAD * 2 +
    STATUS_R * 2 +
    GAP +
    nameW +
    GAP +
    ICON +
    (countText ? COUNT_GAP + countW : 0)

  const baseHalfH = 2 * GRID * U * squash
  const badgeX = cx - badgeW / 2
  const badgeY = cy + baseHalfH + SLAB + 15
  const badgeMidY = badgeY + BADGE_H / 2

  const statusDotX = badgeX + BADGE_PAD + STATUS_R
  const nameX = statusDotX + STATUS_R + GAP
  const iconX = nameX + nameW + GAP
  const countX = iconX + ICON + COUNT_GAP

  return (
    <g transform="translate(0, 8)">
      <rect
        x={badgeX}
        y={badgeY + 10}
        width={badgeW}
        height={BADGE_H}
        rx={6}
        fill={isDark ? 'rgba(10,13,20,0.96)' : 'rgba(240,244,248,0.96)'}
        stroke={sk.line}
        strokeWidth={0.7}
      />
      <circle
        cx={statusDotX}
        cy={badgeMidY + 10}
        r={STATUS_R}
        fill={statusColor}
      />
      <text
        x={nameX}
        y={badgeMidY + 14.5}
        textAnchor="start"
        fontSize={13}
        fontFamily="Geist Sans, ui-sans-serif, system-ui, sans-serif"
        fontWeight={600}
        fill={isDark ? '#f8fafc' : '#1e293b'}
      >
        {displayName}
      </text>
      <StatusIcon
        x={iconX}
        y={badgeMidY + 10 - ICON / 2}
        width={ICON}
        height={ICON}
        color={statusColor}
        data-status-icon={bin}
      />
      {countText && (
        <text
          x={countX}
          y={badgeMidY + 14}
          textAnchor="start"
          // next/font registers Geist under a generated family name, so the
          // literal below never matches; `font-mono` (--font-geist-mono) does.
          className="font-mono"
          fontSize={12}
          fontFamily="Geist Mono, ui-monospace, SFMono-Regular, monospace"
          fontWeight={600}
          fill={isDark ? COUNT_FILL.dark : COUNT_FILL.light}
          data-testid="plant-badge-count"
        >
          {countText}
        </text>
      )}
    </g>
  )
}
