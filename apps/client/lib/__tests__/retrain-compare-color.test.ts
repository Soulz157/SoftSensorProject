import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION_COLOR } from '../retrain-series'

const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')
const EVAL = 'app/(default)/models/create/components/pipeline/evaluation'

describe('Retrain compare line colour', () => {
  it('uses a token defined for light, dark and Tailwind', () => {
    expect(CURRENT_VERSION_COLOR).toBe('var(--chart-6)')
    const css = read('app/globals.css')
    expect(css.match(/^\s*--chart-6: oklch\(/gm)).toHaveLength(2)
    expect(css).toContain('--color-chart-6: var(--chart-6);')
  })

  it.each([
    'actual-vs-predicted-chart.tsx',
    'residual-chart.tsx',
    'evaluation-tooltip.tsx',
  ])('%s reads the shared constant, never a hardcoded token', file => {
    const src = read(`${EVAL}/${file}`)
    expect(src).toContain('CURRENT_VERSION_COLOR')
    expect(src).not.toContain('--chart-4')
  })
})
