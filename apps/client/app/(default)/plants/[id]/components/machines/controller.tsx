import { cn } from '@/lib/utils'
import {
  STATUS_COLORS,
  type MachineSvgProps,
} from '../../../../../../store/status-colors'

export function ControllerSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Cabinet base — top face */}
      <path
        d="M28 72 L50 60 L72 72 L50 84 Z"
        fill="#0d1520"
        stroke={`${color}30`}
        strokeWidth={1}
      />
      {/* Cabinet base — left face */}
      <path
        d="M28 72 L28 80 L50 92 L50 84 Z"
        fill="#081018"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Cabinet base — right face */}
      <path
        d="M72 72 L72 80 L50 92 L50 84 Z"
        fill="#0a1420"
        stroke={`${color}20`}
        strokeWidth={0.8}
      />
      {/* Cabinet tall body — left face */}
      <path
        d="M28 36 L28 72 L50 84 L50 48 Z"
        fill="#0d1825"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Cabinet tall body — right face */}
      <path
        d="M72 36 L72 72 L50 84 L50 48 Z"
        fill="#101e2c"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Cabinet tall body — top face */}
      <path
        d="M28 36 L50 24 L72 36 L50 48 Z"
        fill="#132030"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* HMI Screen face */}
      <path
        d="M30 38 L50 28 L70 38 L50 48 Z"
        fill="#0a1820"
        stroke="#38bdf8"
        strokeWidth={1}
      />
      {/* Screen content */}
      <path
        d="M36 39 L50 32 L64 39 L50 46 Z"
        fill="#061018"
        stroke="#38bdf8"
        strokeWidth={0.5}
      />
      <polyline
        points="39,43 43,40 47,42 51,38 55,41 59,39 63,42"
        fill="none"
        stroke="#38bdf8"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* Control buttons on left face */}
      <circle
        cx={35}
        cy={55}
        r={2.5}
        fill="#22c55e"
        stroke="#4ade80"
        strokeWidth={0.5}
      />
      <circle
        cx={35}
        cy={62}
        r={2.5}
        fill="#1a2530"
        stroke="#38bdf840"
        strokeWidth={0.5}
      />
      <circle
        cx={35}
        cy={69}
        r={2.5}
        fill={color}
        stroke={`${color}80`}
        strokeWidth={0.5}
      />
      {/* LED strip on right face */}
      <rect x={62} y={52} width={4} height={2.5} rx={1} fill="#22c55e" />
      <rect x={62} y={57} width={4} height={2.5} rx={1} fill="#22c55e" />
      <rect x={62} y={62} width={4} height={2.5} rx={1} fill={color} />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={91}
        rx={22}
        ry={8}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.8}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={91}
        rx={34}
        ry={13}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
