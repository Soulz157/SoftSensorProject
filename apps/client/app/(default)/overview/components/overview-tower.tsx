'use client'

import { useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { type NodeStatus } from '@/store/status-colors'
import { toBinaryStatus, BINARY_STATUS_META } from '@/lib/overview-status'

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

const STATUS_PRIORITY: Record<NodeStatus, number> = {
  alarm: 0,
  warning: 1,
  offline: 2,
  normal: 3,
}

const MAX_DOTS = 8
const DOT_SPACING = 6

interface PlantTowerProps {
  cx: number
  cy: number
  nodeCount: number
  status: NodeStatus
  nodeStatuses?: NodeStatus[]
  workspaceColor: string
  name: string
  selected: boolean
  isDark: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
  onDoubleClick: () => void
}

export function PlantTower({
  cx,
  cy,
  nodeCount,
  status,
  nodeStatuses,
  workspaceColor,
  name,
  selected,
  isDark,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onDoubleClick,
}: PlantTowerProps) {
  const accentHex = COLOR_HEX[workspaceColor] ?? '#3b82f6'
  const isAbnormal = toBinaryStatus(status) === 'abnormal'
  const statusColor = BINARY_STATUS_META[toBinaryStatus(status)].color
  const StatusIcon = isAbnormal ? AlertCircle : CheckCircle2
  const towerH = Math.max(40, Math.min(20 + nodeCount * 3, 100))
  const tw = 22

  const sortedStatuses = nodeStatuses
    ? [...nodeStatuses]
        .sort((a, b) => STATUS_PRIORITY[a] - STATUS_PRIORITY[b])
        .slice(0, MAX_DOTS)
    : []
  const extraDots =
    nodeStatuses && nodeStatuses.length > MAX_DOTS
      ? nodeStatuses.length - MAX_DOTS
      : 0
  // ── Name badge layout: [status dot] [name] [equipment dots] [icon] ──
  const displayName = name.length > 10 ? `${name.slice(0, 8)}…` : name

  const BADGE_PAD = 8
  const BADGE_H = 28
  const GAP = 7
  const STATUS_R = 5
  const ICON = 12

  const nameW = 78
  const dotsW =
    sortedStatuses.length > 0
      ? (sortedStatuses.length - 1) * DOT_SPACING + 5 + (extraDots > 0 ? 15 : 0)
      : 0

  const badgeW =
    BADGE_PAD * 2 +
    STATUS_R * 2 +
    GAP +
    nameW +
    (dotsW > 0 ? GAP + dotsW : 0) +
    GAP +
    ICON

  const badgeX = cx - badgeW / 2
  const badgeY = cy + tw * 0.5 + 10
  const badgeMidY = badgeY + BADGE_H / 2

  const statusDotX = badgeX + BADGE_PAD + STATUS_R
  const nameX = statusDotX + STATUS_R + GAP
  const dotsX = nameX + nameW + GAP + 2.5 // center ของ dot ตัวแรก
  const iconX = badgeX + badgeW - BADGE_PAD - ICON
  const topFacePoints = [
    `${cx},${cy - towerH - tw * 0.5}`,
    `${cx + tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx - tw},${cy - towerH}`,
  ].join(' ')

  const leftFacePoints = [
    `${cx - tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx},${cy + tw * 0.5}`,
    `${cx - tw},${cy}`,
  ].join(' ')

  const rightFacePoints = [
    `${cx + tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx},${cy + tw * 0.5}`,
    `${cx + tw},${cy}`,
  ].join(' ')

  const windowColor = isAbnormal ? '#fca5a5' : '#86efac'
  const windowOpacity = 0.75

  const antennaBase = cy - towerH - 12
  const antennaTop = antennaBase - 16

  const factoryTopFace = isDark ? '#1a2535' : '#64748b'
  const factoryTopStroke = isDark ? '#2e3f55' : '#94a3b8'

  const leftFaceBase = isDark ? 'rgba(15,25,45,0.95)' : 'rgba(200,215,228,0.9)'
  const rightFaceBase = isDark ? 'rgba(8,15,30,0.95)' : 'rgba(180,200,220,0.9)'
  const strokeColor = selected ? accentHex : isDark ? '#1e2535' : '#94a3b8'

  const [isFocused, setIsFocused] = useState(false)

  return (
    <g
      className="cursor-pointer motion-safe:transition-transform motion-safe:hover:-translate-y-1"
      tabIndex={0}
      role="button"
      aria-label={`${name} plant — status: ${status}, ${nodeCount} nodes`}
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
      {/* Keyboard focus ring */}
      {isFocused && (
        <ellipse
          cx={cx}
          cy={cy + tw * 0.5}
          rx={tw + 14}
          ry={14}
          fill="none"
          stroke={accentHex}
          strokeWidth={2}
          opacity={0.9}
        />
      )}

      {/* Selection dashed ring */}
      {selected && (
        <ellipse
          cx={cx}
          cy={cy + tw * 0.5}
          rx={tw + 8}
          ry={10}
          fill="none"
          stroke={accentHex}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}
      <g transform="translate(0, 10)">
        {/* 1. Base Plinth / Shadow Platform */}
        <polygon
          points={`
          ${cx},${cy + tw * 0.5 + 4}
          ${cx + tw + 4},${cy + 2}
          ${cx},${cy - tw * 0.5 + 4}
          ${cx - tw - 4},${cy + 2}
        `}
          fill={isDark ? '#0f1827' : '#94a3b8'}
          opacity={0.5}
        />

        {/* 2. Main Tower Body */}
        <polygon
          points={rightFacePoints}
          fill={rightFaceBase}
          stroke={strokeColor}
          strokeWidth={0.6}
          strokeLinejoin="round"
        />
        <polygon
          points={leftFacePoints}
          fill={leftFaceBase}
          stroke={strokeColor}
          strokeWidth={0.6}
          strokeLinejoin="round"
        />

        {/* 3. Structural Details */}
        <line
          x1={cx}
          y1={cy - towerH + tw * 0.5}
          x2={cx}
          y2={cy + tw * 0.5}
          stroke={strokeColor}
          strokeWidth={1}
          opacity={0.5}
        />
        <line
          x1={cx - tw + 2}
          y1={cy - towerH + 1}
          x2={cx - tw + 2}
          y2={cy + 1}
          stroke={strokeColor}
          strokeWidth={0.5}
          opacity={0.3}
        />
        <line
          x1={cx + tw - 2}
          y1={cy - towerH + 1}
          x2={cx + tw - 2}
          y2={cy + 1}
          stroke={strokeColor}
          strokeWidth={0.5}
          opacity={0.3}
        />

        {/* 4. Glowing Vertical Core Line */}
        {status !== 'offline' && (
          <g>
            <path
              d={`M ${cx - 2} ${cy - towerH + tw * 0.5 + 3} L ${cx - 2} ${cy + tw * 0.5 - 3}`}
              stroke={statusColor}
              strokeWidth={1}
              opacity={status === 'alarm' ? 0.8 : 0.5}
              strokeLinecap="round"
            />
            <path
              d={`M ${cx + 2} ${cy - towerH + tw * 0.5 + 3} L ${cx + 2} ${cy + tw * 0.5 - 3}`}
              stroke={statusColor}
              strokeWidth={1}
              opacity={status === 'alarm' ? 0.8 : 0.5}
              strokeLinecap="round"
            />
          </g>
        )}

        {/* 5. Isometric Glass Windows */}
        {Array.from({ length: Math.floor((towerH - 10) / 12) }).map((_, i) => {
          const h = 10 + i * 12
          const wH = 6

          if (h + wH > towerH - 4) return null

          return (
            <g key={`win-${i}`}>
              <polygon
                points={`
                ${cx - 18},${cy - towerH + 2 + h}
                ${cx - 6},${cy - towerH + 8 + h}
                ${cx - 6},${cy - towerH + 8 + h + wH}
                ${cx - 18},${cy - towerH + 2 + h + wH}
              `}
                fill={windowColor}
                opacity={windowOpacity}
              />
              <polygon
                points={`
                ${cx + 6},${cy - towerH + 8 + h}
                ${cx + 18},${cy - towerH + 2 + h}
                ${cx + 18},${cy - towerH + 2 + h + wH}
                ${cx + 6},${cy - towerH + 8 + h + wH}
              `}
                fill={windowColor}
                opacity={windowOpacity - 0.2}
              />
            </g>
          )
        })}

        {/* 6. Tower top (Main Roof) */}
        <polygon
          points={topFacePoints}
          fill={factoryTopFace}
          stroke={factoryTopStroke}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />

        {/* 7. Roof Detail */}
        <g opacity={status === 'offline' ? 0.6 : 0.95}>
          <polygon
            points={`
            ${cx - 8},${cy - towerH - 4}
            ${cx},${cy - towerH}
            ${cx},${cy - towerH - 4}
            ${cx - 8},${cy - towerH - 8}
          `}
            fill={leftFaceBase}
            stroke={strokeColor}
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
          <polygon
            points={`
            ${cx},${cy - towerH - 4}
            ${cx + 8},${cy - towerH - 8}
            ${cx + 8},${cy - towerH - 4}
            ${cx},${cy - towerH}
          `}
            fill={rightFaceBase}
            stroke={strokeColor}
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
          <polygon
            points={`
            ${cx},${cy - towerH - 12}
            ${cx + 8},${cy - towerH - 8}
            ${cx},${cy - towerH - 4}
            ${cx - 8},${cy - towerH - 8}
          `}
            fill={factoryTopFace}
            stroke={factoryTopStroke}
            strokeWidth={0.5}
            strokeLinejoin="round"
          />
        </g>

        {/* 8. Antenna */}
        <line
          x1={cx}
          y1={antennaBase}
          x2={cx}
          y2={antennaTop}
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={antennaTop}
          r={2.5}
          fill={isDark ? '#1e2535' : '#94a3b8'}
          stroke={strokeColor}
          strokeWidth={0.5}
        />

        {/* Name Badge */}
        <rect
          x={badgeX}
          y={badgeY}
          width={badgeW}
          height={BADGE_H}
          rx={6}
          fill={isDark ? 'rgba(10,13,20,0.96)' : 'rgba(240,244,248,0.96)'}
          stroke={strokeColor}
          strokeWidth={0.6}
        />

        {/* Status Circle (ซ้าย) */}
        <circle
          cx={statusDotX}
          cy={badgeMidY}
          r={STATUS_R}
          fill={statusColor}
        />

        {/* Name Text */}
        <text
          x={nameX}
          y={badgeMidY + 4.5}
          textAnchor="start"
          fontSize={13}
          fontFamily="Geist Sans, ui-sans-serif, system-ui, sans-serif"
          fontWeight={600}
          fill={isDark ? '#f8fafc' : '#1e293b'}
        >
          {displayName}
        </text>

        {/* Equipment status dots — inline หลังชื่อ */}
        {sortedStatuses.length > 0 && (
          <g aria-hidden="true">
            {sortedStatuses.map((st, i) => (
              <circle
                key={`s-${i}`}
                cx={dotsX + i * DOT_SPACING}
                cy={badgeMidY}
                r={2.5}
                fill={BINARY_STATUS_META[toBinaryStatus(st)].color}
                opacity={0.95}
              />
            ))}
            {extraDots > 0 && (
              <text
                x={dotsX + sortedStatuses.length * DOT_SPACING}
                y={badgeMidY + 2.5}
                fontSize={7}
                fontFamily="Geist Sans, ui-sans-serif, sans-serif"
                fontWeight={600}
                fill={isDark ? '#94a3b8' : '#475569'}
              >
                +{extraDots}
              </text>
            )}
          </g>
        )}

        {/* Status Icon (ขวา) */}
        <StatusIcon
          x={iconX}
          y={badgeMidY - ICON / 2}
          width={ICON}
          height={ICON}
          color={statusColor}
        />
      </g>
    </g>
  )
}
