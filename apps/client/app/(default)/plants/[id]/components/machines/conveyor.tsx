import { cn } from '@/lib/utils'
import {
  STATUS_COLORS,
  type MachineSvgProps,
} from '../../../../../../store/status-colors'

export function ConveyorSvg({ status, selected = false }: MachineSvgProps) {
  const color = STATUS_COLORS[status]
  const isAlarm = status === 'alarm'
  const isWarning = status === 'warning'

  return (
    <g>
      {/* Belt — top face */}
      <path
        d="M18 58 L50 42 L82 58 L50 74 Z"
        fill="#122018"
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Belt — left face */}
      <path
        d="M18 58 L18 68 L50 84 L50 74 Z"
        fill="#0c1810"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Belt — right face */}
      <path
        d="M82 58 L82 68 L50 84 L50 74 Z"
        fill="#0f1e14"
        stroke={`${color}40`}
        strokeWidth={0.8}
      />
      {/* Belt texture lines */}
      <line
        x1={30}
        y1={58}
        x2={62}
        y2={44}
        stroke="#1a3020"
        strokeWidth={0.8}
      />
      <line
        x1={38}
        y1={62}
        x2={70}
        y2={48}
        stroke="#1a3020"
        strokeWidth={0.8}
      />
      <line
        x1={22}
        y1={60}
        x2={54}
        y2={46}
        stroke="#1a3020"
        strokeWidth={0.8}
      />
      {/* Left roller */}
      <path
        d="M14 52 L22 48 L22 66 L14 70 Z"
        fill="#163a20"
        stroke={color}
        strokeWidth={1.5}
      />
      <ellipse
        cx={18}
        cy={59}
        rx={4}
        ry={8}
        fill="#1a4025"
        stroke={color}
        strokeWidth={1}
      />
      {/* Right roller */}
      <path
        d="M78 48 L86 52 L86 70 L78 66 Z"
        fill="#163a20"
        stroke={color}
        strokeWidth={1.5}
      />
      <ellipse
        cx={82}
        cy={59}
        rx={4}
        ry={8}
        fill="#1a4025"
        stroke={color}
        strokeWidth={1}
      />
      {/* Items on belt */}
      <path
        d="M42 52 L50 48 L58 52 L50 56 Z"
        fill="#0e2818"
        stroke={`${color}50`}
        strokeWidth={0.8}
      />
      <path
        d="M28 58 L36 54 L44 58 L36 62 Z"
        fill="#0e2818"
        stroke={`${color}50`}
        strokeWidth={0.8}
      />
      {/* Status glow ring — inner */}
      <ellipse
        cx={50}
        cy={83}
        rx={36}
        ry={13}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        opacity={0.7}
        className={cn(isAlarm && 'animate-pulse')}
      />
      {/* Status glow ring — outer */}
      <ellipse
        cx={50}
        cy={83}
        rx={50}
        ry={18}
        fill="none"
        stroke={color}
        strokeWidth={5}
        opacity={isAlarm || isWarning ? 0.2 : 0.08}
        className={cn((isAlarm || isWarning) && 'animate-pulse')}
      />
    </g>
  )
}
