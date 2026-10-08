import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ApiError } from '@/lib/fetcher'
import { brandModelVersionNumber } from '@/lib/model-version-number'

// MODEL-SERVE-001-T08. `promote`'s `version` param is branded — a bare `1`
// no longer type-checks at the call site, so every call below mints one
// from a fixed constant rather than repeating the literal-vs-brand
// distinction at each of the 7 call sites.
const V1 = brandModelVersionNumber(1)

const promoteFn = vi.fn()
const success = vi.fn()
const error = vi.fn()

vi.mock('@/services/model-version', () => ({
  modelVersionService: {
    promote: (...args: unknown[]) => promoteFn(...args),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

/** The exact text the backend returns for the r2 floor
 *  (model-version.authorized.service.ts:163-171) — quoted rather than
 *  paraphrased, because the dialog's whole job is to show it verbatim. */
const FLOOR_REFUSAL =
  'Cannot promote: r2 (-0.49) is at or below zero. Provide an override reason to promote it anyway.'

const PROMOTED = { id: 'version-1', version: 1, stage: 'PRODUCTION' }

beforeEach(() => {
  promoteFn.mockReset()
  success.mockReset()
  error.mockReset()
})

async function mount(onPromoted = vi.fn()) {
  const { useModelPromote } = await import('../use-model-promote')
  return { view: renderHook(() => useModelPromote(onPromoted)), onPromoted }
}

describe('useModelPromote', () => {
  it('promotes WITHOUT an override on the first attempt', async () => {
    promoteFn.mockResolvedValue(PROMOTED)
    const { view, onPromoted } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })

    // The third argument must be undefined: sending an override up front
    // would satisfy the r2 floor before anyone had been asked anything.
    expect(promoteFn).toHaveBeenCalledWith('model-1', 1, undefined)
    expect(view.result.current.overridePrompt).toBeNull()
    expect(onPromoted).toHaveBeenCalledTimes(1)
    expect(success).toHaveBeenCalled()
  })

  it('opens the override dialog on a 422, quoting the server VERBATIM', async () => {
    promoteFn.mockRejectedValue(new ApiError(FLOOR_REFUSAL, 422))
    const { view, onPromoted } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })

    await waitFor(() =>
      expect(view.result.current.overridePrompt).toBe(FLOOR_REFUSAL),
    )
    // A refusal is not a promotion: nothing downstream may refresh as if
    // the version had moved.
    expect(onPromoted).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('re-sends with the typed reason and reports success', async () => {
    promoteFn
      .mockRejectedValueOnce(new ApiError(FLOOR_REFUSAL, 422))
      .mockResolvedValueOnce(PROMOTED)
    const { view, onPromoted } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })
    await act(async () => {
      await view.result.current.confirmOverride('  Pilot run, monitored  ')
    })

    // Trimmed, and aimed at the SAME version the refusal was about.
    expect(promoteFn).toHaveBeenLastCalledWith('model-1', 1, {
      reason: 'Pilot run, monitored',
    })
    await waitFor(() => expect(view.result.current.overridePrompt).toBeNull())
    expect(onPromoted).toHaveBeenCalledTimes(1)
  })

  it('REFUSES an empty or whitespace reason without calling the API', async () => {
    promoteFn.mockRejectedValue(new ApiError(FLOOR_REFUSAL, 422))
    const { view } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })
    promoteFn.mockClear()
    await act(async () => {
      await view.result.current.confirmOverride('   ')
    })

    // A blank reason recorded against someone's name is worse than no
    // override at all — it looks like a justification and says nothing.
    expect(promoteFn).not.toHaveBeenCalled()
    expect(view.result.current.overridePrompt).toBe(FLOOR_REFUSAL)
  })

  it('keeps the dialog open when the override is refused AGAIN', async () => {
    // The 422 also covers refusals no reason can fix — a missing artifact,
    // a changed checksum. The retry fails with the same message rather than
    // promoting on a model object that is not there.
    const gone =
      'Cannot promote: model object models/m/model.joblib no longer exists in object storage.'
    promoteFn
      .mockRejectedValueOnce(new ApiError(gone, 422))
      .mockRejectedValueOnce(new ApiError(gone, 422))
    const { view, onPromoted } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })
    await act(async () => {
      await view.result.current.confirmOverride('deploy anyway')
    })

    await waitFor(() => expect(view.result.current.overridePrompt).toBe(gone))
    expect(onPromoted).not.toHaveBeenCalled()
  })

  it('does NOT offer an override for a non-422 failure', async () => {
    promoteFn.mockRejectedValue(new ApiError('Forbidden', 403))
    const { view } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })

    // A permission problem is not something a written reason resolves.
    expect(view.result.current.overridePrompt).toBeNull()
    expect(error).toHaveBeenCalledWith('Forbidden')
  })

  it('dismissing clears the pending version, so a later confirm is inert', async () => {
    promoteFn.mockRejectedValue(new ApiError(FLOOR_REFUSAL, 422))
    const { view } = await mount()

    await act(async () => {
      await view.result.current.promote('model-1', V1)
    })
    act(() => view.result.current.dismissOverride())
    promoteFn.mockClear()
    await act(async () => {
      await view.result.current.confirmOverride('changed my mind')
    })

    expect(view.result.current.overridePrompt).toBeNull()
    expect(promoteFn).not.toHaveBeenCalled()
  })
})
