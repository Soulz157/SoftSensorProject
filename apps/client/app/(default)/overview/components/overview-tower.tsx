'use client'

import { useState } from 'react'
import { CheckCircle2, AlertTriangle, AlertCircle, WifiOff } from 'lucide-react'

type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

const STATUS_COLORS: Record<NodeStatus, string> = {
  normal: '#22c55e',
  warning: '#f59e0b',
  alarm: '#ef4444',
  offline: '#71717a',
}

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

const STATUS_ICONS = {
  normal: CheckCircle2,
  warning: AlertTriangle,
  alarm: AlertCircle,
  offline: WifiOff,
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
  const statusColor = STATUS_COLORS[status]
  const StatusIcon = STATUS_ICONS[status]
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
  const totalDotsW =
    sortedStatuses.length > 0
      ? (sortedStatuses.length - 1) * DOT_SPACING + (extraDots > 0 ? 14 : 0)
      : 0
  const dotsStartX = cx - totalDotsW / 2

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

  const windowColor =
    status === 'alarm'
      ? '#fca5a5'
      : status === 'warning'
        ? '#fcd34d'
        : status === 'offline'
          ? '#71717a'
          : '#10b981'
  const windowOpacity = status === 'offline' ? 0.3 : 0.75

  const antennaBase = cy - towerH - 12
  const antennaTop = antennaBase - 16

  const topFaceColor =
    status === 'alarm'
      ? '#ef4444'
      : status === 'warning'
        ? '#f59e0b'
        : status === 'offline'
          ? '#52525b'
          : accentHex

  const leftFaceBase = isDark ? 'rgba(15,25,45,0.95)' : 'rgba(200,215,228,0.9)'
  const rightFaceBase = isDark ? 'rgba(8,15,30,0.95)' : 'rgba(180,200,220,0.9)'
  const strokeColor = selected ? accentHex : isDark ? '#1e2535' : '#94a3b8'

  const [isFocused, setIsFocused] = useState(false)

  return (
    <g
      className="cursor-pointer motion-safe:transition-transform motion-safe:hover:-translate-y-1"
      tabIndex={0}
      role="button"
      aria-label={`${name} workspace — status: ${status}, ${nodeCount} nodes`}
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

      {/* Status glow at base */}
      <ellipse
        cx={cx}
        cy={cy + tw * 0.5}
        rx={tw + 4}
        ry={8}
        fill={statusColor}
        opacity={status === 'alarm' ? 0.3 : 0.15}
      />
      <ellipse
        cx={cx}
        cy={cy + tw * 0.5}
        rx={tw - 4}
        ry={5}
        fill={statusColor}
        opacity={status === 'alarm' ? 0.4 : 0.2}
      />

      {/* 1. Base Plinth / Shadow Platform */}
      <polygon
        points={`
          ${cx},${cy + tw * 0.5 + 4}
          ${cx + tw + 4},${cy + 2}
          ${cx},${cy - tw * 0.5 + 4}
          ${cx - tw - 4},${cy + 2}
        `}
        fill={isDark ? '#020617' : '#94a3b8'}
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

      {/* 3. Structural Details (Vertical Corner & Center Beams) */}
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

      {/* 4. Glowing Vertical Core Line (Sci-fi / Server Plant Look) */}
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

      {/* 5. Isometric Glass Windows (Perfectly aligned with angles) */}
      {Array.from({ length: Math.floor((towerH - 10) / 12) }).map((_, i) => {
        const h = 10 + i * 12
        const wH = 6

        if (h + wH > towerH - 4) return null

        return (
          <g key={`win-${i}`}>
            {/* Left face window */}
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
            {/* Right face window */}
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
        fill={topFaceColor}
        stroke={
          status === 'normal'
            ? '#a5f3fc'
            : status === 'alarm'
              ? '#fca5a5'
              : status === 'warning'
                ? '#fde68a'
                : '#d4d4d8'
        }
        strokeWidth={1.2}
        strokeLinejoin="round"
        opacity={status === 'offline' ? 0.6 : 1}
      />

      {/* 7. Roof Detail: Secondary Inner Box (Machinery / AC Unit) */}
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
          fill={topFaceColor}
          stroke={strokeColor}
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
        stroke={status === 'offline' ? '#71717a' : accentHex}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={status === 'offline' ? '2 2' : undefined}
      />

      {/* 9. Beacon */}
      {status === 'alarm' && (
        <>
          <circle cx={cx} cy={antennaTop} r={5} fill="#ef4444" opacity={0.9} />
          <circle
            cx={cx}
            cy={antennaTop}
            r={10}
            fill="none"
            stroke="#ef4444"
            strokeWidth={1.5}
            opacity={0.5}
          />
        </>
      )}
      {status === 'warning' && (
        <>
          <circle cx={cx} cy={antennaTop} r={4} fill="#f59e0b" opacity={0.85} />
          <circle
            cx={cx}
            cy={antennaTop}
            r={8}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1}
            opacity={0.4}
          />
        </>
      )}
      {(status === 'normal' || status === 'offline') && (
        <circle
          cx={cx}
          cy={antennaTop}
          r={2.5}
          fill={status === 'offline' ? '#52525b' : accentHex}
        />
      )}

      {/* Name Badge */}
      <rect
        x={cx - 50}
        y={cy + tw * 0.5 + 10}
        width={100}
        height={18}
        rx={4}
        fill={isDark ? 'rgba(10,13,20,0.92)' : 'rgba(240,244,248,0.92)'}
        stroke={strokeColor}
        strokeWidth={0.6}
      />

      <circle cx={cx - 38} cy={cy + tw * 0.5 + 19} r={3.5} fill={statusColor} />

      <text
        x={cx - 28}
        y={cy + tw * 0.5 + 22}
        textAnchor="start"
        fontSize={8}
        fontFamily="Geist Sans, ui-sans-serif, system-ui, sans-serif"
        fontWeight={600}
        fill={isDark ? '#f8fafc' : '#1e293b'}
      >
        {name.length > 10 ? `${name.slice(0, 10)}…` : name}
      </text>

      <StatusIcon
        x={cx + 35}
        y={cy + tw * 0.5 + 14}
        width={10}
        height={10}
        color={statusColor}
      />

      {/* Equipment status dots — below name badge */}
      {sortedStatuses.length > 0 && (
        <g>
          <rect
            x={dotsStartX - 4}
            y={cy + tw * 0.5 + 30}
            width={totalDotsW + 8}
            height={10}
            rx={5}
            fill={isDark ? 'rgba(6,8,15,0.75)' : 'rgba(240,244,248,0.85)'}
            stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}
            strokeWidth={0.5}
          />
          {sortedStatuses.map((st, i) => (
            <circle
              key={`s-${i}`}
              cx={dotsStartX + i * DOT_SPACING}
              cy={cy + tw * 0.5 + 35}
              r={2.5}
              fill={STATUS_COLORS[st]}
              opacity={0.95}
            />
          ))}
          {extraDots > 0 && (
            <text
              x={dotsStartX + sortedStatuses.length * DOT_SPACING}
              y={cy + tw * 0.5 + 38}
              fontSize={5.5}
              fontFamily="Geist Sans, ui-sans-serif, sans-serif"
              fontWeight={700}
              fill={isDark ? '#94a3b8' : '#475569'}
            >
              +{extraDots}
            </text>
          )}
        </g>
      )}
    </g>
  )
}
