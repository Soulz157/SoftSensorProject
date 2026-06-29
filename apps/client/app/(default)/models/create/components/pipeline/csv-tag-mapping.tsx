'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Search,
  ListFilter,
  X,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MOCK_PI_TAGS } from '@/lib/mock-readings'
import {
  mpManualTagsRawAtom,
  mpTagInputMethodAtom,
} from '@/store/model-pipeline'

export interface MappedTag {
  original: string
  input: string
  piTag: string | null
  status: 'match' | 'invalid'
  source: 'typed' | 'inserted'
}

const CSV_COLUMNS = ['temp_c', 'TI-101', 'VI-202', 'pressure_bar', 'PI-303']

function parseManualTags(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function buildMappedTags(
  baseInputs: string[],
  insertedTags: string[],
  editedTags: Record<string, string>,
  removedTags: string[],
): MappedTag[] {
  const safeInserted = Array.isArray(insertedTags) ? insertedTags : []
  const safeRemoved = Array.isArray(removedTags) ? removedTags : []
  const safeEdited =
    editedTags && typeof editedTags === 'object' ? editedTags : {}

  const typedRows: MappedTag[] = baseInputs
    .filter(original => !safeRemoved.includes(original))
    .map(original => {
      const input = safeEdited[original] ?? original
      const match = MOCK_PI_TAGS.find(
        t => t.piTag.toLowerCase() === input.toLowerCase(),
      )
      return {
        original,
        input,
        piTag: match?.piTag ?? null,
        status: match ? 'match' : 'invalid',
        source: 'typed',
      } as MappedTag
    })

  const typedOriginals = new Set(typedRows.map(r => r.original))
  const insertedRows: MappedTag[] = safeInserted
    .filter(tag => !typedOriginals.has(tag) && !safeRemoved.includes(tag))
    .map(tag => ({
      original: tag,
      input: tag,
      piTag: tag,
      status: 'match' as const,
      source: 'inserted' as const,
    }))

  return [...typedRows, ...insertedRows]
}

const STATUS_META = {
  match: {
    label: 'Match Found',
    icon: CheckCircle2,
    classes: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    iconClass: 'text-emerald-500',
  },
  invalid: {
    label: 'Invalid',
    icon: XCircle,
    classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    iconClass: 'text-rose-500',
  },
}

interface Props {
  onTagsConfirmed: (tags: string[]) => void
  editedTags: Record<string, string>
  removedTags: string[]
  insertedTags: string[]
  onEditTag: (original: string, corrected: string) => void
  onRemoveTag: (original: string) => void
  onInsertTag: (tag: string) => void
  onRemoveInsertedTag: (tag: string) => void
  onHasInvalidTagsChange: (value: boolean) => void
  sourceName?: string
}

export function CsvTagMapping({
  onTagsConfirmed,
  editedTags,
  removedTags,
  insertedTags,
  onEditTag,
  onRemoveTag,
  onInsertTag,
  onRemoveInsertedTag,
  onHasInvalidTagsChange,
  sourceName = 'Data Source',
}: Props) {
  const tagInputMethod = useAtomValue(mpTagInputMethodAtom)
  const manualTagsRaw = useAtomValue(mpManualTagsRawAtom)

  const [query, setQuery] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [editingOriginal, setEditingOriginal] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const listBottomRef = useRef<HTMLDivElement>(null)

  const baseInputs =
    tagInputMethod === 'text' ? parseManualTags(manualTagsRaw) : CSV_COLUMNS

  const mapped = useMemo(
    () =>
      buildMappedTags(
        baseInputs,
        Array.isArray(insertedTags) ? insertedTags : [],
        editedTags ?? {},
        Array.isArray(removedTags) ? removedTags : [],
      ),
    [baseInputs, insertedTags, editedTags, removedTags],
  )

  useEffect(() => {
    const matched = mapped
      .filter(t => t.status === 'match' && t.piTag !== null)
      .map(t => t.piTag as string)
    onTagsConfirmed(matched)
    onHasInvalidTagsChange(mapped.some(t => t.status === 'invalid'))
  }, [mapped, onTagsConfirmed, onHasInvalidTagsChange])

  const prevInsertedLen = useRef(
    Array.isArray(insertedTags) ? insertedTags.length : 0,
  )
  useEffect(() => {
    const currentLen = Array.isArray(insertedTags) ? insertedTags.length : 0
    if (currentLen > prevInsertedLen.current) {
      listBottomRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
    prevInsertedLen.current = currentLen
  }, [insertedTags])

  const q = query.trim().toLowerCase()

  const allSourceTags: string[] = MOCK_PI_TAGS.map(t => t.piTag)

  const filteredSourceTags = q
    ? allSourceTags.filter(t => t.toLowerCase().includes(q))
    : allSourceTags

  const filteredMapped = q
    ? mapped.filter(
        t =>
          t.input.toLowerCase().includes(q) ||
          (t.piTag?.toLowerCase().includes(q) ?? false),
      )
    : mapped

  const matchCount = mapped.filter(t => t.status === 'match').length
  const invalidCount = mapped.filter(t => t.status === 'invalid').length

  const startEdit = (tag: MappedTag) => {
    setEditingOriginal(tag.original)
    setEditValue(tag.input)
  }

  const commitEdit = () => {
    if (editingOriginal === null) return
    const trimmed = editValue.trim()
    if (trimmed) onEditTag(editingOriginal, trimmed)
    setEditingOriginal(null)
  }

  const handleRemove = (tag: MappedTag) => {
    if (editingOriginal === tag.original) setEditingOriginal(null)
    if (tag.source === 'inserted') {
      onRemoveInsertedTag(tag.original)
    } else {
      onRemoveTag(tag.original)
    }
  }

  const safeInserted = Array.isArray(insertedTags) ? insertedTags : []
  const handleBrowserToggle = (tag: string, checked: boolean) => {
    if (checked) {
      onInsertTag(tag)
    } else {
      onRemoveInsertedTag(tag)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tags…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Browse toggle lives INSIDE the search bar row to show they share scope */}
        <div className="h-4 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setShowBrowser(prev => !prev)}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
            showBrowser
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ListFilter className="h-3 w-3" />
          {showBrowser ? 'Hide' : 'Browse'} source
        </button>
      </div>

      {showBrowser && (
        <div className="rounded-xl border border-border/60 bg-muted/30">
          <div className="border-b border-border/60 px-4 py-2.5">
            <p className="text-xs font-semibold text-foreground">
              {sourceName}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {filteredSourceTags.length} tag
              {filteredSourceTags.length !== 1 ? 's' : ''}
              {q ? ` matching "${query}"` : ''} · tick to add
            </p>
          </div>

          <div className="max-h-52 overflow-y-auto divide-y divide-border/40">
            {filteredSourceTags.length === 0 && (
              <p className="px-4 py-3 text-center text-xs text-muted-foreground">
                No tags match `{query}`
              </p>
            )}
            {filteredSourceTags.map(tag => {
              const checked = safeInserted.includes(tag)
              return (
                <label
                  key={tag}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-4 py-2 text-xs transition-colors select-none',
                    checked
                      ? 'bg-emerald-500/5 text-foreground'
                      : 'hover:bg-muted/60 text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-border bg-background',
                    )}
                  >
                    {checked && (
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => handleBrowserToggle(tag, e.target.checked)}
                    className="sr-only"
                  />
                  <span className="font-mono">{tag}</span>
                  {checked && (
                    <span className="ml-auto text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      Added
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Tag validation results
            </p>
            <p className="text-xs text-muted-foreground">
              {matchCount} matched · {invalidCount} invalid
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Match
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Invalid
            </span>
          </div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border/60">
          {filteredMapped.length === 0 && mapped.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No tags yet. Type tags above or browse the source to add.
            </p>
          )}
          {filteredMapped.length === 0 && mapped.length > 0 && (
            <p className="px-4 py-4 text-center text-xs text-muted-foreground">
              No tags match `{query}`
            </p>
          )}

          {filteredMapped.map(tag => {
            const meta = STATUS_META[tag.status]
            const Icon = meta.icon
            const isEditing = editingOriginal === tag.original

            return (
              <div
                key={`${tag.source}::${tag.original}`}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 transition-colors',
                  tag.source === 'inserted' && !isEditing && 'bg-emerald-500/3',
                )}
              >
                <Icon
                  className={cn('h-4 w-4 shrink-0', meta.iconClass)}
                  aria-hidden="true"
                />

                {/* Tag name / inline edit */}
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setEditingOriginal(null)
                      }}
                      className="w-full rounded border border-primary bg-transparent px-2 py-0.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring/50"
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <p className="font-mono text-xs font-medium text-foreground">
                          {tag.input}
                        </p>
                        {tag.source === 'inserted' && (
                          <span className="rounded-full bg-sky-500/10 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:text-sky-400">
                            from source
                          </span>
                        )}
                      </div>
                      {tag.status === 'match' &&
                        tag.piTag &&
                        tag.piTag !== tag.input && (
                          <p className="text-[11px] text-muted-foreground">
                            →&nbsp;{tag.piTag}
                          </p>
                        )}
                    </>
                  )}
                </div>

                {/* Status badge */}
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    meta.classes,
                  )}
                >
                  {meta.label}
                </span>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {/* ✏️ Edit — ALL rows (both valid and invalid), not editing currently */}
                  {!isEditing && (
                    <button
                      type="button"
                      title="Edit tag name"
                      onClick={() => startEdit(tag)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* 🗑️ Delete — all rows */}
                  <button
                    type="button"
                    title="Remove tag"
                    onClick={() => handleRemove(tag)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}

          <div ref={listBottomRef} />
        </div>
      </div>
    </div>
  )
}
