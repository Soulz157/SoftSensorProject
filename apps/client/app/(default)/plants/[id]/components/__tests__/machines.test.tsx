import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CncMachineSvg } from '../machines/cnc-machine'
import { RobotArmSvg } from '../machines/robot-arm'
import { SensorSvg } from '../machines/sensor'
import { ConveyorSvg } from '../machines/conveyor'
import { ControllerSvg } from '../machines/controller'

const STATUSES = ['normal', 'warning', 'alarm', 'offline'] as const

describe('Machine SVG components', () => {
  const components = [
    { name: 'CncMachineSvg', Component: CncMachineSvg },
    { name: 'RobotArmSvg', Component: RobotArmSvg },
    { name: 'SensorSvg', Component: SensorSvg },
    { name: 'ConveyorSvg', Component: ConveyorSvg },
    { name: 'ControllerSvg', Component: ControllerSvg },
  ]

  components.forEach(({ name, Component }) => {
    STATUSES.forEach(status => {
      it(`${name} renders with status="${status}" without crashing`, () => {
        const { container } = render(
          <svg>
            <Component status={status} />
          </svg>,
        )
        expect(container.querySelector('g')).not.toBeNull()
      })
    })

    it(`${name} selected=true renders without crashing`, () => {
      const { container } = render(
        <svg>
          <Component status="normal" selected />
        </svg>,
      )
      expect(container.querySelector('g')).not.toBeNull()
    })
  })
})
