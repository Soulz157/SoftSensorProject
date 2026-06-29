'use client'

import { useState, useCallback } from 'react'
import type { ModelTag } from '@/lib/mock-model-create'

/**
 * Shared PI-server + tag-role selection state for the Create and Edit model
 * flows. Pure local state (no IO) — consumed by both `use-create-model.ts`
 * (useState) and `use-model-form.ts` (useReducer) so the toggle/role logic
 * isn't duplicated.
 *
 * Phase-6 mock exception: tags are UI-only and not persisted yet (see
 * `lib/mock-model-create.ts`). The server -> tag-catalog link is cosmetic —
 * `MOCK_PI_TAGS` is static, not per-server.
 */

export function useModelTagSelection() {
  const [piServerId, setPiServerIdState] = useState('')
  const [tags, setTags] = useState<ModelTag[]>([])

  // Changing the PI server clears the previously picked tags (cascade reset).
  const setPiServerId = useCallback((id: string) => {
    setPiServerIdState(id)
    setTags([])
  }, [])

  // Tags are selected as model inputs only (no input/output role toggle).
  const toggleTag = useCallback((piTag: string) => {
    setTags(prev =>
      prev.some(t => t.piTag === piTag)
        ? prev.filter(t => t.piTag !== piTag)
        : [...prev, { piTag, role: 'input' }],
    )
  }, [])

  // Clears server + tags — call when the parent workspace changes.
  const reset = useCallback(() => {
    setPiServerIdState('')
    setTags([])
  }, [])

  return { piServerId, setPiServerId, tags, toggleTag, reset }
}
