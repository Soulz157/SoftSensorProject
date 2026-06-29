'use client'

import { useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { rawDatasetAtom, timeRangeAtom } from '@/store/data-visualize'
import { StepView } from './step-view'
import type { Dataset } from '@/lib/preprocessing'

export function Step5RawData() {
  const raw = useAtomValue(rawDatasetAtom)
  const range = useAtomValue(timeRangeAtom)

  const [selectedTags, setSelectedTags] = useState<string[]>(raw?.tags || [])

  const toggleTag = (tagToToggle: string) => {
    setSelectedTags(prev =>
      prev.includes(tagToToggle)
        ? prev.filter(t => t !== tagToToggle)
        : [...prev, tagToToggle],
    )
  }

  const selectAll = () => {
    if (raw?.tags) setSelectedTags(raw.tags)
  }

  const clearAll = () => {
    setSelectedTags([])
  }

  const filteredDataset = useMemo(() => {
    if (!raw) return null
    return {
      ...raw,
      tags: selectedTags,
    } as Dataset
  }, [raw, selectedTags])

  const summary = useMemo(() => {
    if (!raw || selectedTags.length === 0)
      return '0 rows · 0 bad · 0 questionable cells'

    const badRows = raw.rows.filter(r =>
      selectedTags.some(t => r.cells[t]?.status === 'Bad'),
    ).length

    let questionableCells = 0
    for (const r of raw.rows) {
      for (const t of selectedTags) {
        if (r.cells[t]?.status === 'Questionable') questionableCells++
      }
    }
    return `${raw.rows.length} rows · ${badRows} bad · ${questionableCells} questionable cells`
  }, [raw, selectedTags])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 p-4 rounded-xl ring-1 ring-foreground/10 bg-card">
        <span className="text-xs font-medium text-muted-foreground mr-2 tracking-wide uppercase">
          Tags
        </span>

        {raw.tags.map(tag => {
          const isSelected = selectedTags.includes(tag)
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`
                h-5 px-2 text-xs rounded-full font-mono transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
                ${
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent ring-1 ring-border text-foreground hover:bg-muted'
                }
              `}
            >
              {tag}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-1 border-l border-border pl-3">
          <button
            onClick={selectAll}
            className="h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none"
          >
            All
          </button>
          <button
            onClick={clearAll}
            className="h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none"
          >
            Clear
          </button>
        </div>
      </div>

      {filteredDataset && (
        <StepView
          dataset={filteredDataset}
          range={range}
          showQuality
          summary={summary}
        />
      )}
    </div>
  )
}
