import { cn } from '@/lib/utils'
import { STATUS_COLORS, type MachineSvgProps } from './status-colors'

export function RobotArmSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Base — top face */}
      <path
        d="M28 72 L50 62 L72 72 L50 82 Z"
        fill="#122818"
        stroke={`${color}50`}
        strokeWidth={1}
      />
      {/* Base — left face */}
      <path
        d="M28 72 L28 80 L50 90 L50 82 Z"
        fill="#0d1e10"
        stroke={`${color}30`}
        strokeWidth={0.8}
      />
      {/* Base — right face */}
      <path
        d="M72 72 L72 80 L50 90 L50 82 Z"
        fill="#102215"
        stroke={`${color}30`}
        strokeWidth={0.8}
      />
      {/* Lower arm */}
      <path
        d="M42 62 L58 54 L58 40 L42 48 Z"
        fill="#143520"
        stroke={`${color}60`}
        strokeWidth={1}
      />
      {/* Joint */}
      <circle
        cx={50}
        cy={43}
        r={5}
        fill="#1a4028"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Upper arm */}
      <path
        d="M44 43 L56 37 L62 22 L50 28 Z"
        fill="#1a4028"
        stroke={color}
        strokeWidth={1.2}
      />
      {/* Gripper body */}
      <path
        d="M57 22 L66 18 L68 26 L59 30 Z"
        fill="#0f2218"
        stroke={color}
        strokeWidth={1}
      />
      {/* Gripper fingers */}
      <line
        x1={63}
        y1={18}
        x2={68}
        y2={14}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <line
        x1={63}
        y1={22}
        x2={69}
        y2={20}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={89}
        rx={24}
        ry={9}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.8}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={89}
        rx={36}
        ry={14}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.1}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
