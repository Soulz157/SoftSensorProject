import { cn } from '@/lib/utils'
import {
  STATUS_COLORS,
  type MachineSvgProps,
} from '../../../../../store/status-colors'

export function CncMachineSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Base platform */}
      <path
        d="M20 68 L50 52 L80 68 L50 84 Z"
        fill="#0d1f35"
        stroke={`${color}30`}
        strokeWidth={1}
      />
      {/* Body — right face */}
      <path
        d="M72 44 L72 68 L50 80 L50 56 Z"
        fill="#112438"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Body — left face */}
      <path
        d="M28 44 L28 68 L50 80 L50 56 Z"
        fill="#0d2235"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Body — top face */}
      <path
        d="M28 44 L50 32 L72 44 L50 56 Z"
        fill="#163550"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Head — left face */}
      <path d="M36 32 L36 44 L50 52 L50 40 Z" fill="#122e42" strokeWidth={0} />
      {/* Head — right face */}
      <path d="M64 32 L64 44 L50 52 L50 40 Z" fill="#163650" strokeWidth={0} />
      {/* Head — top face */}
      <path
        d="M36 32 L50 24 L64 32 L50 40 Z"
        fill="#1e4560"
        stroke="#38bdf8"
        strokeWidth={1.5}
      />
      {/* Spindle shaft */}
      <line
        x1={50}
        y1={28}
        x2={50}
        y2={38}
        stroke="#38bdf8"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={50} cy={38} r={2.5} fill="#38bdf8" />
      {/* Tool bit */}
      <line
        x1={50}
        y1={38}
        x2={50}
        y2={46}
        stroke="#94a3b8"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <polygon points="48,46 52,46 50,51" fill="#94a3b8" />
      {/* Panel details */}
      <rect
        x={35}
        y={58}
        width={8}
        height={5}
        rx={1}
        fill="#1a3a55"
        stroke={`${color}50`}
        strokeWidth={0.5}
      />
      <rect
        x={45}
        y={58}
        width={4}
        height={5}
        rx={1}
        fill="#0e2030"
        stroke={`${color}30`}
        strokeWidth={0.5}
      />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={83}
        rx={26}
        ry={10}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.8}
        opacity={0.9}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer (soft) */}
      <ellipse
        cx={50}
        cy={83}
        rx={38}
        ry={15}
        fill="none"
        stroke={color}
        strokeWidth={6}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
