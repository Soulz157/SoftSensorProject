import { CncMachineSvg } from './machines/cnc-machine'
import { RobotArmSvg } from './machines/robot-arm'
import { SensorSvg } from './machines/sensor'
import { ConveyorSvg } from './machines/conveyor'
import { ControllerSvg } from './machines/controller'
import { type NodeStatus } from './machines/status-colors'

interface MachineNodeProps {
  type: 'machine' | 'sensor' | 'controller'
  icon: string | undefined
  status: NodeStatus
  label: string
  isoX: number
  isoY: number
  selected: boolean
  onClick: () => void
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

export function MachineNode({
  type,
  icon,
  status,
  label,
  isoX,
  isoY,
  selected,
  onClick,
}: MachineNodeProps) {
  return (
    <g
      transform={`translate(${isoX - 50}, ${isoY - 70})`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {pickMachineSvg(type, icon, status, selected)}
      <text
        x={50}
        y={100}
        textAnchor="middle"
        fontSize={selected ? 8 : 7}
        fontWeight={selected ? 700 : 600}
        fill={selected ? '#e2e8f0' : '#94a3b8'}
        fontFamily="monospace"
      >
        {label}
      </text>
    </g>
  )
}
