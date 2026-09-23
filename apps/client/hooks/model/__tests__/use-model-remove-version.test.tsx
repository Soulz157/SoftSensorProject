import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ApiError } from '@/lib/fetcher'
import { brandModelVersionNumber } from '@/lib/model-version-number'

// MODEL-SERVE-017-V02. The split this hook exists to get right: a 422 is a
// SPECIFIC refusal the user can act on and gets a dialog carrying the
// server's own sentence; everything else is a toast. Getting it backwards
// either buries an actionable reason in a toast or opens a dialog on a
// network blip.
const V3 = brandModelVersionNumber(3)

const removeFn = vi.fn()
const success = vi.fn()
const error = vi.fn()

vi.mock('@/services/model-version', () => ({
  modelVersionService: {
    remove: (...args: unknown[]) => removeFn(...args),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

/** Verbatim from removeVersionService — the dialog's job is to quote it. */
const HELD_REFUSAL =
  'Cannot remove v3: 4 inference window(s) still reference it.'

beforeEach(() => {
  removeFn.mockReset()
  success.mockReset()
  error.mockReset()
})

async function mount(onRemoved = vi.fn()) {
  const { useModelRemoveVersion } = await import('../use-model-remove-version')
  return { view: renderHook(() => useModelRemoveVersion(onRemoved)), onRemoved }
}

describe('useModelRemoveVersion (MODEL-SERVE-017-V02)', () => {
  it('reports success and lets the caller refresh the table', async () => {
    removeFn.mockResolvedValue({ id: 'version-3', version: 3 })
    const { view, onRemoved } = await mount()

    await act(async () => {
      await view.result.current.remove('m-1', V3)
    })

    expect(removeFn).toHaveBeenCalledWith('m-1', 3)
    expect(onRemoved).toHaveBeenCalledTimes(1)
    expect(success).toHaveBeenCalledWith('Version 3 removed')
    expect(view.result.current.refusal).toBeNull()
  })

  it('opens the refusal dialog with the server’s own words on a 422', async () => {
    removeFn.mockRejectedValue(new ApiError(HELD_REFUSAL, 422))
    const { view, onRemoved } = await mount()

    await act(async () => {
      await view.result.current.remove('m-1', V3)
    })

    expect(view.result.current.refusal).toBe(HELD_REFUSAL)
    // Nothing was removed, so the table must NOT be refetched as if it had
    // been — a refresh here would imply the row is gone.
    expect(onRemoved).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('toasts, without a dialog, for anything that is not a 422', async () => {
    removeFn.mockRejectedValue(new ApiError('Forbidden', 403))
    const { view, onRemoved } = await mount()

    await act(async () => {
      await view.result.current.remove('m-1', V3)
    })

    expect(view.result.current.refusal).toBeNull()
    expect(error).toHaveBeenCalledWith('Forbidden')
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('clears the refusal when dismissed, so a retry starts clean', async () => {
    removeFn.mockRejectedValue(new ApiError(HELD_REFUSAL, 422))
    const { view } = await mount()

    await act(async () => {
      await view.result.current.remove('m-1', V3)
    })
    act(() => view.result.current.dismissRefusal())

    expect(view.result.current.refusal).toBeNull()
  })

  it('settles busy back to false after a refusal', async () => {
    // The confirm's Remove button is disabled on `busy`; a stuck `true`
    // after a refusal would leave the tab unable to try anything again.
    removeFn.mockRejectedValue(new ApiError(HELD_REFUSAL, 422))
    const { view } = await mount()

    await act(async () => {
      await view.result.current.remove('m-1', V3)
    })

    expect(view.result.current.busy).toBe(false)
  })
})
