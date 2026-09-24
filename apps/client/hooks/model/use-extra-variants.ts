'use client'

import { useCallback, useMemo } from 'react'
import { useAtom } from 'jotai'
import {
  mpExtraVariantsAtom,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'

export interface UseExtraVariantsResult {
  /** This algorithm's own hand-added rows, in the order they were added. */
  variants: Record<string, HyperparamValue>[]
  /** Appends `seed` as a new row. The caller decides what a new row starts
   *  as — the variant table seeds it from the values the card is currently
   *  showing, so "+ Add" gives a row the user can edit rather than a blank
   *  one they must fill before it means anything. */
  add: (seed: Record<string, HyperparamValue>) => void
  update: (index: number, key: string, value: HyperparamValue) => void
  remove: (index: number) => void
}

/** The server's own bound, mirrored so the button can disable rather than
 *  let a request 400: `CreateCandidateJobSchema.extraVariants` is `.max(8)`. */
export const MAX_EXTRA_VARIANTS = 8

const EMPTY: Record<string, HyperparamValue>[] = []

/**
 * MODEL-FLOW-026. The hand-added variant rows for ONE algorithm — the store
 * read/write kept out of the table component, the same split every other
 * Step 3 panel follows.
 *
 * The rows are NOT run-config draft state (see `mpExtraVariantsAtom`'s own
 * doc comment): they add fits to a search, they do not change the run that
 * search starts from, so there is no dirty/Apply cycle here and no
 * /split-stats refetch.
 */
export function useExtraVariants(algorithm: Algorithm): UseExtraVariantsResult {
  const [all, setAll] = useAtom(mpExtraVariantsAtom)

  // A stable empty array, so a card with no rows does not hand its consumers
  // a new reference on every render.
  const variants = useMemo(() => all[algorithm] ?? EMPTY, [all, algorithm])

  const add = useCallback(
    (seed: Record<string, HyperparamValue>) =>
      setAll(prev => {
        const current = prev[algorithm] ?? []
        if (current.length >= MAX_EXTRA_VARIANTS) return prev
        return { ...prev, [algorithm]: [...current, { ...seed }] }
      }),
    [algorithm, setAll],
  )

  const update = useCallback(
    (index: number, key: string, value: HyperparamValue) =>
      setAll(prev => {
        const current = prev[algorithm]
        if (!current?.[index]) return prev
        return {
          ...prev,
          [algorithm]: current.map((row, i) =>
            i === index ? { ...row, [key]: value } : row,
          ),
        }
      }),
    [algorithm, setAll],
  )

  const remove = useCallback(
    (index: number) =>
      setAll(prev => {
        const current = prev[algorithm]
        if (!current) return prev
        return { ...prev, [algorithm]: current.filter((_, i) => i !== index) }
      }),
    [algorithm, setAll],
  )

  return { variants, add, update, remove }
}
