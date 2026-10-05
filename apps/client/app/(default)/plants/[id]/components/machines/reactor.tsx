import { cn } from '@/lib/utils'
import {
  STATUS_COLORS,
  type MachineSvgProps,
} from '../../../../../../store/status-colors'

export function ReactorSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Support legs */}
      <line
        x1={36}
        y1={78}
        x2={34}
        y2={89}
        stroke="#1e2d3d"
        strokeWidth={2.5}
      />
      <line
        x1={64}
        y1={78}
        x2={66}
        y2={89}
        stroke="#1e2d3d"
        strokeWidth={2.5}
      />
      <line
        x1={50}
        y1={83}
        x2={50}
        y2={92}
        stroke="#1e2d3d"
        strokeWidth={2.5}
      />
      {/* Vessel body — cylinder side */}
      <path
        d="M32 38 L32 76 A18 7 0 0 0 68 76 L68 38 Z"
        fill="#0d1825"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Right-hand shading, to read as round */}
      <path
        d="M56 44.5 L56 82.6 A18 7 0 0 0 68 76 L68 38 A18 7 0 0 1 56 44.5 Z"
        fill="#101e2c"
      />
      {/* Bottom rim */}
      <path
        d="M32 76 A18 7 0 0 0 68 76"
        fill="none"
        stroke={`${color}60`}
        strokeWidth={1}
      />
      {/* Domed head */}
      <path
        d="M32 38 A18 13 0 0 1 68 38 A18 7 0 0 1 32 38 Z"
        fill="#132030"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Head seam */}
      <path
        d="M32 38 A18 7 0 0 0 68 38"
        fill="none"
        stroke={`${color}80`}
        strokeWidth={1}
      />
      {/* Agitator motor on top */}
      <rect
        x={45}
        y={17}
        width={10}
        height={9}
        rx={1.5}
        fill="#0a1420"
        stroke="#38bdf8"
        strokeWidth={0.8}
      />
      <line
        x1={50}
        y1={26}
        x2={50}
        y2={30}
        stroke="#38bdf8"
        strokeWidth={1.2}
      />
      {/* Side outlet pipe with flange */}
      <path d="M68 56 L79 56" stroke="#1e2d3d" strokeWidth={3} />
      <rect x={78} y={52.5} width={2.5} height={7} rx={0.6} fill="#38bdf8" />
      {/* Sight glass with liquid level */}
      <rect
        x={44}
        y={47}
        width={12}
        height={20}
        rx={2}
        fill="#0a1820"
        stroke="#38bdf8"
        strokeWidth={0.8}
      />
      <rect
        x={45.5}
        y={56}
        width={9}
        height={9.5}
        rx={1}
        fill={color}
        opacity={0.55}
      />
      {/* Status lamp */}
      <circle
        cx={37}
        cy={50}
        r={2.2}
        fill={color}
        stroke={`${color}80`}
        strokeWidth={0.5}
      />
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
