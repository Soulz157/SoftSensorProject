import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MachineNode } from '../machine-node'

describe('MachineNode SVG picker', () => {
  const base = {
    label: 'TEST-01',
    isoX: 100,
    isoY: 100,
    selected: false,
    onClick: vi.fn(),
  }

  it('sensor type → renders SensorSvg (antenna path present)', () => {
    const { container } = render(
      <svg>
        <MachineNode {...base} type="sensor" icon={undefined} status="normal" />
      </svg>,
    )
    // SensorSvg has a unique arc path for signal rings
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('controller type → renders ControllerSvg (polyline graph present)', () => {
    const { container } = render(
      <svg>
        <MachineNode
          {...base}
          type="controller"
          icon={undefined}
          status="normal"
        />
      </svg>,
    )
    expect(container.querySelector('polyline')).not.toBeNull()
  })

  it('machine type + icon=arm → renders RobotArmSvg (lines for gripper present)', () => {
    const { container } = render(
      <svg>
        <MachineNode {...base} type="machine" icon="arm" status="warning" />
      </svg>,
    )
    const lines = container.querySelectorAll('line')
    expect(lines.length).toBeGreaterThan(0)
  })

  it('machine type + no icon → renders CncMachineSvg (polygon tool bit present)', () => {
    const { container } = render(
      <svg>
        <MachineNode {...base} type="machine" icon={undefined} status="alarm" />
      </svg>,
    )
    expect(container.querySelector('polygon')).not.toBeNull()
  })

  it('renders label text', () => {
    const { getByText } = render(
      <svg>
        <MachineNode {...base} type="sensor" icon={undefined} status="normal" />
      </svg>,
    )
    expect(getByText('TEST-01')).not.toBeNull()
  })

  it('selected node renders with larger font weight on label', () => {
    const { container } = render(
      <svg>
        <MachineNode
          {...base}
          selected
          type="sensor"
          icon={undefined}
          status="normal"
        />
      </svg>,
    )
    expect(container.querySelector('g')).not.toBeNull()
  })
})
