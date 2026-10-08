import { describe, expect, it } from 'vitest'
import { clusterOrder, reorderMatrix } from './correlation-order'

// Two blocks interleaved in the input: {A, C} and {B, D}.
const blocks = {
  tags: ['A', 'B', 'C', 'D'],
  matrix: [
    [1, 0.05, 0.95, 0.1],
    [0.05, 1, 0.02, 0.9],
    [0.95, 0.02, 1, 0.08],
    [0.1, 0.9, 0.08, 1],
  ],
}

function adjacent(order: string[], a: string, b: string): boolean {
  return Math.abs(order.indexOf(a) - order.indexOf(b)) === 1
}

describe('clusterOrder', () => {
  it('puts members of a correlated block next to each other', () => {
    const tags = clusterOrder(blocks).map(i => blocks.tags[i]!)
    expect(tags).toEqual(['A', 'C', 'B', 'D'])
    expect(adjacent(tags, 'A', 'C')).toBe(true)
    expect(adjacent(tags, 'B', 'D')).toBe(true)
  })

  it('groups a strong NEGATIVE pair as similar', () => {
    const m = {
      tags: ['A', 'B', 'C'],
      matrix: [
        [1, 0.1, -0.97],
        [0.1, 1, 0.2],
        [-0.97, 0.2, 1],
      ],
    }
    const tags = clusterOrder(m).map(i => m.tags[i]!)
    expect(adjacent(tags, 'A', 'C')).toBe(true)
  })

  it('treats a non-finite r as unrelated', () => {
    const m = {
      tags: ['A', 'B', 'C'],
      matrix: [
        [1, Number.NaN, 0.1],
        [Number.NaN, 1, 0.9],
        [0.1, 0.9, 1],
      ],
    }
    const tags = clusterOrder(m).map(i => m.tags[i]!)
    expect(adjacent(tags, 'B', 'C')).toBe(true)
  })

  it('is deterministic and a permutation of every index', () => {
    const first = clusterOrder(blocks)
    expect(clusterOrder(blocks)).toEqual(first)
    expect([...first].sort()).toEqual([0, 1, 2, 3])
  })

  it('leaves two or fewer tags in place', () => {
    expect(
      clusterOrder({
        tags: ['A', 'B'],
        matrix: [
          [1, 0.3],
          [0.3, 1],
        ],
      }),
    ).toEqual([0, 1])
  })
})

describe('reorderMatrix', () => {
  it('permutes rows and columns together, keeping symmetry and the diagonal', () => {
    const out = reorderMatrix(blocks, [0, 2, 1, 3])
    expect(out.tags).toEqual(['A', 'C', 'B', 'D'])
    out.matrix.forEach((row, i) => {
      expect(row[i]).toBe(1)
      row.forEach((r, j) => expect(r).toBe(out.matrix[j]![i]))
    })
    expect(out.matrix[0]![1]).toBe(0.95)
  })
})
