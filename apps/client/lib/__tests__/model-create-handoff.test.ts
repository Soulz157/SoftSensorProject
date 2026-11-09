import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearModelCreateHandoff,
  consumeModelCreateHandoff,
  modelCreateReturnUrl,
  peekModelCreateHandoff,
  rememberModelCreateHandoff,
} from '@/lib/model-create-handoff'

const KEY = 'softsensor.model-create-handoff'

const STEP_ONE = {
  name: 'Boiler efficiency',
  description: '',
  workspaceId: 'ws-1',
  plantId: '',
  nodeId: '',
}

beforeEach(() => sessionStorage.clear())

describe('model-create-handoff (MODEL-FLOW-032)', () => {
  it('round-trips Step 1, and peek leaves it in place', () => {
    rememberModelCreateHandoff(STEP_ONE)

    expect(peekModelCreateHandoff()).toEqual(STEP_ONE)
    expect(peekModelCreateHandoff()).toEqual(STEP_ONE)
  })

  it('consume reads once, then the intent is gone', () => {
    rememberModelCreateHandoff(STEP_ONE)

    expect(consumeModelCreateHandoff()).toEqual(STEP_ONE)
    expect(consumeModelCreateHandoff()).toBeNull()
  })

  it('clear drops the intent', () => {
    rememberModelCreateHandoff(STEP_ONE)
    clearModelCreateHandoff()

    expect(peekModelCreateHandoff()).toBeNull()
  })

  it('discards a stored value whose shape no longer matches', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ name: 'x' }))
    expect(peekModelCreateHandoff()).toBeNull()

    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...STEP_ONE, workspaceId: '' }),
    )
    expect(peekModelCreateHandoff()).toBeNull()

    sessionStorage.setItem(KEY, '{not json')
    expect(peekModelCreateHandoff()).toBeNull()
  })

  it('builds a fixed same-origin return URL with the dataset id encoded', () => {
    expect(modelCreateReturnUrl('ds-1')).toBe(
      '/models/create?newDatasetId=ds-1',
    )
    expect(modelCreateReturnUrl('a b&c')).toBe(
      '/models/create?newDatasetId=a+b%26c',
    )
  })
})
