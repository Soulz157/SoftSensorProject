import { cn } from '@/lib/utils'
import {
  STATUS_COLORS,
  type MachineSvgProps,
} from '../../../../../store/status-colors'

export function SensorSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Base — top face */}
      <path
        d="M36 76 L50 68 L64 76 L50 84 Z"
        fill="#1a2030"
        stroke={`${color}30`}
        strokeWidth={1}
      />
      {/* Base — left face */}
      <path
        d="M36 76 L36 82 L50 90 L50 84 Z"
        fill="#111828"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Base — right face */}
      <path
        d="M64 76 L64 82 L50 90 L50 84 Z"
        fill="#141c2e"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Cylinder body — top face */}
      <path
        d="M40 56 L50 50 L60 56 L50 62 Z"
        fill="#1e2845"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Cylinder body — left face */}
      <path
        d="M40 56 L40 76 L50 82 L50 62 Z"
        fill="#141c35"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Cylinder body — right face */}
      <path
        d="M60 56 L60 76 L50 82 L50 62 Z"
        fill="#181e3c"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Antenna */}
      <line
        x1={50}
        y1={50}
        x2={50}
        y2={32}
        stroke="#a78bfa"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle
        cx={50}
        cy={30}
        r={3}
        fill="#a78bfa"
        stroke="#c4b5fd"
        strokeWidth={1}
      />
      {/* Signal rings */}
      <path
        d="M44 36 Q50 30 56 36"
        fill="none"
        stroke="#a78bfa70"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M40 40 Q50 30 60 40"
        fill="none"
        stroke="#a78bfa50"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M36 44 Q50 30 64 44"
        fill="none"
        stroke="#a78bfa30"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Status LED */}
      <circle cx={50} cy={67} r={2} fill={color} />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={89}
        rx={18}
        ry={7}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.9}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={89}
        rx={28}
        ry={11}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
