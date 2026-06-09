'use client'

import { CncMachineSvg } from './machines/cnc-machine'
import { RobotArmSvg } from './machines/robot-arm'
import { SensorSvg } from './machines/sensor'
import { ConveyorSvg } from './machines/conveyor'
import { ControllerSvg } from './machines/controller'
import { type NodeStatus } from '../../../../../store/status-colors'
import { cn } from '@/lib/utils' // ตรวจสอบ path ของ utils ให้ตรงกับโปรเจกต์คุณ

interface MachineNodeProps {
  type: 'machine' | 'sensor' | 'controller'
  icon: string | undefined
  status: NodeStatus
  label: string
  isoX: number
  isoY: number
  selected: boolean
  onClick: () => void
  isViewMode?: boolean
}

function pickMachineSvg(
  type: MachineNodeProps['type'],
  icon: string | undefined,
  status: NodeStatus,
  selected: boolean,
) {
  if (type === 'sensor')
    return <SensorSvg status={status} selected={selected} />
  if (type === 'controller')
    return <ControllerSvg status={status} selected={selected} />
  if (icon === 'arm') return <RobotArmSvg status={status} selected={selected} />
  if (icon === 'conveyor')
    return <ConveyorSvg status={status} selected={selected} />
  return <CncMachineSvg status={status} selected={selected} />
}

const STATUS_SHADOW: Record<NodeStatus, string> = {
  normal: 'rgba(16, 185, 129, 0.4)',
  warning: 'rgba(245, 158, 11, 0.5)',
  alarm: 'rgba(239, 68, 68, 0.8)',
  offline: 'rgba(148, 163, 184, 0.2)',
}

const STATUS_HEX: Record<NodeStatus, string> = {
  normal: '#10b981',
  warning: '#f59e0b',
  alarm: '#ef4444',
  offline: '#94a3b8',
}

export function MachineNode({
  type,
  icon,
  status,
  label,
  isoX,
  isoY,
  selected,
  onClick,
  isViewMode = false,
}: MachineNodeProps) {
  const isAlarm = status === 'alarm'
  const shadowColor = STATUS_SHADOW[status] || STATUS_SHADOW.offline

  return (
    <g
      transform={`translate(${isoX - 50}, ${isoY - 70})`}
      onClick={onClick}
      className="cursor-pointer group"
    >
      {/* HUD tag above machine */}
      {isViewMode && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={4}
            y={-21}
            width={92}
            height={16}
            rx={8}
            fill="#0f172a"
            fillOpacity={0.88}
            stroke={STATUS_HEX[status]}
            strokeWidth="1"
          />
          <circle
            cx={15}
            cy={-13}
            r={3.5}
            fill={STATUS_HEX[status]}
            className={status === 'alarm' ? 'animate-pulse' : ''}
          />
          <text
            x={23}
            y={-9}
            fontSize={7}
            fontWeight={600}
            fill="#f8fafc"
            fontFamily="monospace"
          >
            {label.length > 12 ? label.slice(0, 12) + '…' : label}
          </text>
          <text
            x={91}
            y={-9}
            textAnchor="end"
            fontSize={6}
            fontWeight={700}
            fill={STATUS_HEX[status]}
            fontFamily="monospace"
          >
            {status.toUpperCase()}
          </text>
        </g>
      )}

      {/* CSS Keyframes for alarm pulse */}
      <style>{`
        @keyframes pulse-node-${status} {
          0%, 100% { 
            filter: drop-shadow(0 0 15px rgba(239, 68, 68, 0.6)); 
            transform: translateY(0px);
          }
          50% { 
            filter: drop-shadow(0 0 30px rgba(239, 68, 68, 1)); 
            transform: translateY(-4px); 
          }
        }
        .anim-alarm-node {
          animation: pulse-node-alarm 1.5s infinite ease-in-out;
        }
      `}</style>

      {/* 2. ห่อ Component เครื่องจักรเพื่อใส่ Hover Lift และ Drop Shadow */}
      <g
        className={cn(
          'transition-all duration-300 group-hover:-translate-y-2', // ลอยขึ้นเมื่อ Hover
          isAlarm && 'anim-alarm-node', // กระพริบเมื่อเป็น Alarm
          selected && 'drop-shadow-[0_0_20px_rgba(59,130,246,0.8)]', // โกลว์สีฟ้าเมื่อถูกคลิก
        )}
        style={
          !isAlarm && !selected
            ? { filter: `drop-shadow(0px 15px 15px ${shadowColor})` }
            : undefined
        }
      >
        {pickMachineSvg(type, icon, status, selected)}
      </g>

      {/* 3. Marker บอกว่าโดน Select อยู่ (ลูกศรเด้งๆ ชี้ลงบนหัวเครื่องจักร) */}
      {selected && (
        <path
          d="M 50,-10 L 56,0 L 44,0 Z"
          fill="#3b82f6"
          className="animate-bounce drop-shadow-md"
        />
      )}
    </g>
  )
}
