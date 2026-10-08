import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ fetchClient: vi.fn() }))
vi.mock('@/lib/fetcher', () => ({ fetchClient: h.fetchClient }))

import { tuningGridService } from '@/services/tuning-grid'

/**
 * MODEL-FLOW-024. The tuning-grid URL is the whole contract the client has with
 * the size-aware endpoint, so it is pinned directly. The one property that
 * matters most is negative: an UNSIZED call must be byte-for-byte the URL it
 * always was, or every existing caller changes behaviour without meaning to.
 */
describe('tuningGridService.get — MODEL-FLOW-024 query', () => {
  beforeEach(() => {
    h.fetchClient.mockReset()
    h.fetchClient.mockResolvedValue({ variants: [] })
  })

  const urlOf = () => h.fetchClient.mock.calls[0]![0] as string

  it('is the plain URL, with no `?`, when nothing is known', async () => {
    await tuningGridService.get('xgboost')
    expect(urlOf()).toBe('/api/v1/authorized/training/tuning-grid/xgboost')

    h.fetchClient.mockClear()
    await tuningGridService.get('xgboost', {})
    expect(urlOf()).toBe('/api/v1/authorized/training/tuning-grid/xgboost')

    h.fetchClient.mockClear()
    await tuningGridService.get('xgboost', {
      distinctLabelled: null,
      rows: null,
      features: null,
    })
    expect(urlOf()).toBe('/api/v1/authorized/training/tuning-grid/xgboost')
  })

  it('sends each known figure under its own name — distinct values and rows are never swapped', async () => {
    await tuningGridService.get('xgboost', {
      distinctLabelled: 32,
      rows: 8_350,
      features: 12,
    })
    const params = new URL(urlOf(), 'http://x').searchParams
    expect(params.get('distinctLabelled')).toBe('32')
    expect(params.get('rows')).toBe('8350')
    expect(params.get('features')).toBe('12')
  })

  it('omits a null or nonsense figure rather than sending the string "null"', async () => {
    await tuningGridService.get('pls', { distinctLabelled: 32, features: 0 })
    const params = new URL(urlOf(), 'http://x').searchParams
    expect(params.get('distinctLabelled')).toBe('32')
    expect(params.has('rows')).toBe(false)
    expect(params.has('features')).toBe(false)
  })

  it('sends modelId, for a caller with no split stats', async () => {
    await tuningGridService.get('xgboost', undefined, 'model-uuid-1')
    expect(urlOf()).toBe(
      '/api/v1/authorized/training/tuning-grid/xgboost?modelId=model-uuid-1',
    )
  })

  it('sends both an explicit figure and modelId, leaving the precedence to the server', async () => {
    await tuningGridService.get('xgboost', { distinctLabelled: 900 }, 'm-1')
    const params = new URL(urlOf(), 'http://x').searchParams
    expect(params.get('distinctLabelled')).toBe('900')
    expect(params.get('modelId')).toBe('m-1')
  })

  it('encodes the algorithm segment', async () => {
    await tuningGridService.get('a/b')
    expect(urlOf()).toBe('/api/v1/authorized/training/tuning-grid/a%2Fb')
  })
})
