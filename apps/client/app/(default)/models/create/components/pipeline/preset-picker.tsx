'use client'
import { useState } from 'react'
import { Check, Copy, Cpu, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { readModelConfig } from '@/lib/model-config'
import { useModelPreset } from '@/hooks/model/use-model-preset'

interface Props {
  workspaceId: string
}

export function PresetPicker({ workspaceId }: Props) {
  const { models, loading, applyPreset } = useModelPreset(workspaceId)
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')

  if (!workspaceId) return null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? models.filter(
        m =>
          m.name.toLowerCase().includes(q) ||
          (readModelConfig(m)?.description ?? '').toLowerCase().includes(q),
      )
    : models

  const handleSelect = (id: string) => {
    const next = id === selectedId ? '' : id
    setSelectedId(next)
    if (next) applyPreset(next)
  }

  const selectedModel = models.find(m => m.id === selectedId)

  return (
    <Card className="border-dashed border-border bg-muted/30">
      <CardContent className="space-y-3 pt-4">
        {/* ── Header ── */}
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium text-foreground">
            Start from an existing model
          </Label>
          <Badge
            variant="secondary"
            className="text-[10px] uppercase tracking-wide"
          >
            Optional
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Clone the data source, tags, and processing rules from a model in this
          workspace. Name and location stay empty so you create a new instance.
        </p>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search models…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={loading || models.length === 0}
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {selectedModel && (
            <Badge
              variant="outline"
              className="flex shrink-0 items-center gap-1.5 border-primary/40 bg-primary/5 pl-2 pr-1 text-[11px] text-primary"
            >
              <Cpu className="h-3 w-3" />
              <span className="max-w-20 truncate">{selectedModel.name}</span>
              <button
                type="button"
                onClick={() => setSelectedId('')}
                aria-label="Clear selected model"
                className="ml-0.5 rounded-sm text-primary/60 transition-colors hover:text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Cpu className="h-7 w-7 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              No models to clone yet
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No models match &quot;{query}&quot;
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map(m => {
              const isSelected = selectedId === m.id
              const desc = readModelConfig(m)?.description?.trim()
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={cn(
                    'group relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-accent',
                  )}
                >
                  {isSelected && (
                    <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                  )}
                  <div
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      isSelected
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                    )}
                  >
                    <Cpu className="h-4 w-4" />
                  </div>
                  <p
                    className={cn(
                      'truncate text-[11px] font-semibold leading-tight',
                      isSelected ? 'text-primary' : 'text-foreground',
                    )}
                    title={m.name}
                  >
                    {m.name}
                  </p>
                  {desc ? (
                    <p
                      className="line-clamp-2 text-[10px] leading-relaxed text-muted-foreground"
                      title={desc}
                    >
                      {desc}
                    </p>
                  ) : (
                    <p className="text-[10px] italic leading-relaxed text-muted-foreground/60">
                      No description
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
