import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useWizardNavigation } from '../use-wizard-navigation'
import {
  plantIdAtom,
  piServerIdAtom,
  selectedTagsAtom,
  fetchStateAtom,
  rawDatasetAtom,
  fillStrategiesAtom,
  selectedModelIdAtom,
  currentStepAtom,
  highestUnlockedAtom,
} from '@/store/data-visualize'

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
})

function renderNav() {
  return renderHook(() => useWizardNavigation(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

describe('useWizardNavigation', () => {
  it('canAdvance gates each step on its precondition', () => {
    const { result } = renderNav()
    expect(result.current.canAdvance(1)).toBe(false)
    expect(result.current.canAdvance(2)).toBe(false)
    expect(result.current.canAdvance(3)).toBe(false)
    expect(result.current.canAdvance(4)).toBe(false)
    expect(result.current.canAdvance(5)).toBe(true)
    expect(result.current.canAdvance(6)).toBe(false)
    expect(result.current.canAdvance(7)).toBe(false)

    act(() => {
      store.set(plantIdAtom, 'plant-1')
      store.set(piServerIdAtom, 'srv-1')
      store.set(selectedTagsAtom, ['tag-1'])
      store.set(fetchStateAtom, { status: 'done', progress: 100 })
      store.set(rawDatasetAtom, {
        tags: ['tag-1'],
        rows: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            cells: { 'tag-1': { value: 1, status: 'Good' } },
          },
        ],
      })
      store.set(selectedModelIdAtom, 'model-1')
    })

    expect(result.current.canAdvance(1)).toBe(true)
    expect(result.current.canAdvance(2)).toBe(true)
    expect(result.current.canAdvance(3)).toBe(true)
    expect(result.current.canAdvance(4)).toBe(true)
    expect(result.current.canAdvance(6)).toBe(true)
    expect(result.current.canAdvance(7)).toBe(true)
  })

  it('canAdvance(6) is false when the fill strategy drops every row', () => {
    store.set(plantIdAtom, 'plant-1')
    store.set(rawDatasetAtom, {
      tags: ['tag-1'],
      rows: [
        {
          timestamp: '2026-01-01T00:00:00Z',
          cells: { 'tag-1': { value: 1, status: 'Bad' } },
        },
      ],
    })
    store.set(fillStrategiesAtom, { 'tag-1': { strategy: 'drop' } })
    const { result } = renderNav()
    expect(result.current.canAdvance(6)).toBe(false)
  })

  it('goTo clamps to [1, TOTAL_WIZARD_STEPS] and to highestUnlocked', () => {
    const { result } = renderNav()
    act(() => result.current.goTo(7))
    expect(result.current.currentStep).toBe(1) // highestUnlocked still 1

    act(() => store.set(highestUnlockedAtom, 4))
    const { result: result2 } = renderNav()
    act(() => result2.current.goTo(0))
    expect(result2.current.currentStep).toBe(1)
    act(() => result2.current.goTo(99))
    expect(result2.current.currentStep).toBe(1) // 99 > highestUnlocked(4), rejected
    act(() => result2.current.goTo(4))
    expect(result2.current.currentStep).toBe(4)
  })

  it('next() only advances when canAdvance(currentStep) is true, and raises highestUnlocked', () => {
    const { result } = renderNav()
    act(() => result.current.next())
    expect(result.current.currentStep).toBe(1) // step 1 blocked, plantId empty

    act(() => store.set(plantIdAtom, 'plant-1'))
    act(() => result.current.next())
    expect(result.current.currentStep).toBe(2)
    expect(result.current.highestUnlocked).toBe(2)
  })

  it('back() decrements but never below 1', () => {
    store.set(currentStepAtom, 1)
    const { result } = renderNav()
    act(() => result.current.back())
    expect(result.current.currentStep).toBe(1)
  })

  it('setWorkspaceId cascades a full reset to step 1', () => {
    store.set(plantIdAtom, 'plant-1')
    store.set(piServerIdAtom, 'srv-1')
    store.set(selectedTagsAtom, ['tag-1'])
    store.set(currentStepAtom, 5)
    store.set(highestUnlockedAtom, 5)
    const { result } = renderNav()

    act(() => result.current.setWorkspaceId('ws-2'))

    expect(store.get(plantIdAtom)).toBe('')
    expect(store.get(piServerIdAtom)).toBe('')
    expect(store.get(selectedTagsAtom)).toEqual([])
    expect(result.current.currentStep).toBe(1)
    expect(result.current.highestUnlocked).toBe(1)
  })

  it('setPlantId resets downstream state and clamps highestUnlocked to 2', () => {
    store.set(piServerIdAtom, 'srv-1')
    store.set(selectedTagsAtom, ['tag-1'])
    store.set(highestUnlockedAtom, 6)
    const { result } = renderNav()

    act(() => result.current.setPlantId('plant-2'))

    expect(store.get(piServerIdAtom)).toBe('')
    expect(store.get(selectedTagsAtom)).toEqual([])
    expect(result.current.highestUnlocked).toBe(2)
  })

  it('setSelectedTags prunes fillStrategies to surviving tags and clamps highestUnlocked to 3', () => {
    store.set(fillStrategiesAtom, {
      'tag-1': { strategy: 'forward' },
      'tag-2': { strategy: 'mean' },
    })
    store.set(highestUnlockedAtom, 6)
    const { result } = renderNav()

    act(() => result.current.setSelectedTags(['tag-1']))

    expect(store.get(fillStrategiesAtom)).toEqual({
      'tag-1': { strategy: 'forward' },
    })
    expect(result.current.highestUnlocked).toBe(3)
  })

  it('setTimeRange resets the dataset/fetch status but leaves fillStrategies untouched', () => {
    store.set(fillStrategiesAtom, { 'tag-1': { strategy: 'forward' } })
    store.set(rawDatasetAtom, {
      tags: ['tag-1'],
      rows: [
        {
          timestamp: '2026-01-01T00:00:00Z',
          cells: { 'tag-1': { value: 1, status: 'Good' } },
        },
      ],
    })
    store.set(fetchStateAtom, { status: 'done', progress: 100 })
    store.set(highestUnlockedAtom, 6)
    const { result } = renderNav()

    act(() => result.current.setTimeRange('7d'))

    expect(store.get(fillStrategiesAtom)).toEqual({
      'tag-1': { strategy: 'forward' },
    })
    expect(store.get(rawDatasetAtom)).toEqual({ tags: [], rows: [] })
    expect(store.get(fetchStateAtom)).toEqual({ status: 'idle', progress: 0 })
    expect(result.current.highestUnlocked).toBe(3)
  })
})
