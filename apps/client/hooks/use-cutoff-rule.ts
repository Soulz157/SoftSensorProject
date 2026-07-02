import { useCallback, useState } from 'react'
import { nanoid } from 'nanoid'
import type { CutoffRule } from '@/types/cutoff'

export function useCutoffRules(defaultTag: string) {
  const [rules, setRules] = useState<CutoffRule[]>([])

  const add = useCallback(() => {
    setRules(prev => [
      ...prev,
      {
        id: nanoid(6),
        tag: defaultTag,
        op: '>',
        value: '',
        mode: 'highlight',
        enabled: true,
      },
    ])
  }, [defaultTag])

  const update = useCallback(
    <K extends keyof CutoffRule>(id: string, key: K, val: CutoffRule[K]) => {
      setRules(prev => prev.map(r => (r.id === id ? { ...r, [key]: val } : r)))
    },
    [],
  )

  const remove = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
  }, [])

  const toggle = useCallback((id: string) => {
    setRules(prev =>
      prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    )
  }, [])

  return { rules, add, update, remove, toggle }
}
