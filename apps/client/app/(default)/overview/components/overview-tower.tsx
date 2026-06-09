'use client'

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

interface PlantTowerProps {
  cx: number
  cy: number
  nodeCount: number
  status: NodeStatus
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
  const towerH = Math.max(40, Math.min(20 + nodeCount * 3, 100))
  const tw = 22 // half-width of tower

  // Isometric tower faces — origin at (cx, cy)
  // Top face (diamond) centered at (cx, cy - towerH)
  const topFacePoints = [
    `${cx},${cy - towerH - tw * 0.5}`,
    `${cx + tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx - tw},${cy - towerH}`,
  ].join(' ')

  // Left face
  const leftFacePoints = [
    `${cx - tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx},${cy + tw * 0.5}`,
    `${cx - tw},${cy}`,
  ].join(' ')

  // Right face
  const rightFacePoints = [
    `${cx + tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx},${cy + tw * 0.5}`,
    `${cx + tw},${cy}`,
  ].join(' ')

  // Windows on left face — rows based on tower height
  const windowRows = Math.min(Math.floor(towerH / 18), 4)
  const windows: { x: number; y: number }[] = []
  for (let row = 0; row < windowRows; row++) {
    const wy = cy - towerH + tw * 0.5 + 10 + row * 18
    windows.push({ x: cx - tw + 8, y: wy })
    windows.push({ x: cx - tw + 16, y: wy })
  }

  // Antenna
  const antennaBase = cy - towerH - tw * 0.5
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

  return (
    <g
      className="cursor-pointer transition-transform hover:-translate-y-1"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onDoubleClick={e => {
        e.preventDefault()
        onDoubleClick()
      }}
    >
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

      {/* Tower body — right face */}
      <polygon
        points={rightFacePoints}
        fill={rightFaceBase}
        stroke={strokeColor}
        strokeWidth={0.6}
      />

      {/* Tower body — left face */}
      <polygon
        points={leftFacePoints}
        fill={leftFaceBase}
        stroke={strokeColor}
        strokeWidth={0.6}
      />

      {/* Windows on left face */}
      {windows.map((w, i) => (
        <rect
          key={`w-${w.x}-${w.y}`}
          x={w.x}
          y={w.y}
          width={5}
          height={7}
          rx={1}
          fill={
            status === 'alarm'
              ? '#fca5a5'
              : status === 'warning'
                ? '#fcd34d'
                : '#93c5fd'
          }
          opacity={0.6 + (i % 2) * 0.2}
        />
      ))}

      {/* Tower top face */}
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
        opacity={status === 'offline' ? 0.6 : 1}
      />

      {/* Antenna */}
      <line
        x1={cx}
        y1={antennaBase}
        x2={cx}
        y2={antennaTop}
        stroke={status === 'offline' ? '#71717a' : accentHex}
        strokeWidth={1.5}
        strokeDasharray={status === 'offline' ? '2 2' : undefined}
      />

      {/* Beacon on antenna tip */}
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

      {/* ========================================
        Name label (พร้อมตัว Status Circle)
        ========================================
      */}
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
        fontFamily="monospace"
        fontWeight={600}
        fill={isDark ? '#f8fafc' : '#1e293b'}
      >
        {name.length > 12 ? `${name.slice(0, 12)}…` : name}
      </text>
    </g>
  )
}
