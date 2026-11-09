import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NodeStatus } from '@/store/status-colors'
import { PlantTower } from '../tower'

/**
 * MODEL-SERVE-033. Golden markup for the plant tower.
 *
 * The scene is painter-ordered: the order elements are pushed IS the SVG
 * z-order. Moving the drawing code between files must not change a single
 * byte of output, and a screenshot can miss a reordering that this catches.
 * Each case stores a sha256 of the markup (the raw markup is ~50 KB a case);
 * on a mismatch, render the case and diff it against the old file's output.
 */

const noop = () => {}

function towerMarkup(p: {
  lod: boolean
  status: NodeStatus
  squash: number
  equipmentCount: number
  selected?: boolean
  chip?: { abnormal: number; total: number } | null
}): string {
  return renderToStaticMarkup(
    <svg>
      <PlantTower
        cx={200}
        cy={150}
        equipmentCount={p.equipmentCount}
        status={p.status}
        workspaceColor="violet"
        name="Boiler Plant A"
        selected={p.selected ?? false}
        chip={p.chip ?? null}
        squash={p.squash}
        lod={p.lod}
        onMouseEnter={noop}
        onMouseLeave={noop}
        onClick={noop}
        onDoubleClick={noop}
      />
    </svg>,
  )
}

function digest(markup: string): string {
  return `${markup.length}:${createHash('sha256').update(markup).digest('hex')}`
}

describe('PlantTower golden markup', () => {
  for (const lod of [true, false]) {
    for (const status of ['normal', 'alarm', 'offline'] as const) {
      for (const squash of [0.5, 0.42]) {
        for (const equipmentCount of [0, 30]) {
          it(`lod=${lod} status=${status} squash=${squash} count=${equipmentCount}`, () => {
            const markup = towerMarkup({ lod, status, squash, equipmentCount })
            expect(markup.length).toBeGreaterThan(1000)
            expect(digest(markup)).toMatchSnapshot()
          })
        }
      }
    }
  }

  it('selected ring', () => {
    const markup = towerMarkup({
      lod: true,
      status: 'normal',
      squash: 0.42,
      equipmentCount: 8,
      selected: true,
    })
    expect(markup).toContain('stroke-dasharray="4 3"')
    expect(digest(markup)).toMatchSnapshot()
  })

  it('names the abnormal count only when there is one', () => {
    const base = {
      lod: false,
      status: 'alarm',
      squash: 0.5,
      equipmentCount: 8,
    } as const
    expect(towerMarkup({ ...base, chip: { abnormal: 2, total: 8 } })).toContain(
      ', 2 of 8 equipment abnormal',
    )
    expect(towerMarkup({ ...base, chip: null })).not.toContain(
      'equipment abnormal',
    )
  })
})
