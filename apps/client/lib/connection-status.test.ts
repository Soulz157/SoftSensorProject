import { describe, expect, it } from 'vitest'
import { deriveConnectionComponents } from './connection-status'

describe('deriveConnectionComponents', () => {
  it('idle: connection + PI server idle, asset unverified', () => {
    expect(deriveConnectionComponents('idle')).toEqual({
      connection: 'idle',
      piServer: 'idle',
      assetServer: 'unverified',
    })
  })

  it('testing: connection + PI server pending', () => {
    expect(deriveConnectionComponents('testing')).toEqual({
      connection: 'pending',
      piServer: 'pending',
      assetServer: 'unverified',
    })
  })

  it('ok: connection + PI server ok', () => {
    expect(deriveConnectionComponents('ok')).toEqual({
      connection: 'ok',
      piServer: 'ok',
      assetServer: 'unverified',
    })
  })

  it('error: connection + PI server error', () => {
    expect(deriveConnectionComponents('error')).toEqual({
      connection: 'error',
      piServer: 'error',
      assetServer: 'unverified',
    })
  })

  it('asset server is NEVER anything but unverified (no fabricated status)', () => {
    for (const state of ['idle', 'testing', 'ok', 'error'] as const) {
      expect(deriveConnectionComponents(state).assetServer).toBe('unverified')
    }
  })
})
