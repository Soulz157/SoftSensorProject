'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'
import { dataSourceService, type TagMetaItem } from '@/services/data-sources'
import type { WriteBackConfigView } from '@/services/model-evaluation'

const NUMERIC = /^(float|int)/i
const MIN_QUERY = 2
const MAX_SHOWN = 8

/**
 * A tag name input with PI tag-search suggestions. Free text is allowed — the
 * server verifies the tag in PI on save — but only numeric points are
 * suggested, since a prediction cannot be stored in a digital or string
 * point.
 */
function TagField({
  id,
  label,
  value,
  onChange,
  sourceId,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  sourceId: string
}) {
  const [focused, setFocused] = useState(false)
  const [found, setFound] = useState<TagMetaItem[]>([])
  const query = value.trim()
  const enabled = focused && query.length >= MIN_QUERY

  useDebouncedAbortableRequest<TagMetaItem[]>({
    enabled,
    cacheKey: enabled ? `writeback-tags|${sourceId}|${query}` : null,
    debounceMs: 400,
    fetcher: async () => {
      const res = await dataSourceService.metadata(sourceId, {
        nameFilter: `*${query}*`,
        page: 1,
        pageSize: 40,
      })
      return res.data.tags
    },
    onLoading: () => undefined,
    onSettled: result => {
      setFound(result.status === 'ready' ? result.data : [])
    },
    onIdle: () => setFound([]),
  })

  const suggestions = found
    .filter(t => NUMERIC.test(t.point_type ?? ''))
    .filter(t => t.tag_name.toLowerCase() !== query.toLowerCase())
    .slice(0, MAX_SHOWN)

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        // Delay so a click on a suggestion lands before the list unmounts.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Leave blank to turn this write off"
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
      />
      {focused && suggestions.length > 0 && (
        <ul
          aria-label={`${label} suggestions`}
          className="max-h-44 overflow-auto rounded-md border border-border bg-popover text-sm shadow-sm"
        >
          {suggestions.map(t => (
            <li key={t.tag_name}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left hover:bg-accent"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  onChange(t.tag_name)
                  setFocused(false)
                }}
              >
                <span className="truncate font-mono">{t.tag_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.point_type}
                  {t.unit ? ` · ${t.unit}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Form({
  view,
  onSave,
  onClose,
}: {
  view: WriteBackConfigView
  onSave: (tags: {
    predictionTag: string | null
    labTag: string | null
  }) => Promise<void>
  onClose: () => void
}) {
  const [prediction, setPrediction] = useState(view.config?.predictionTag ?? '')
  const [lab, setLab] = useState(view.config?.labTag ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sourceId = view.source?.id ?? ''

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        predictionTag: prediction.trim() || null,
        labTag: lab.trim() || null,
      })
      onClose()
    } catch (err) {
      // The server's sentence names the rule that failed (not found, not
      // numeric, is the lab target, is an input) — shown as written.
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the output tags.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>PI output tags</DialogTitle>
        <DialogDescription>
          Where this model&apos;s values are written on{' '}
          {view.source?.name ?? 'its data source'}. These must be separate
          output tags
          {view.targetTag && (
            <>
              : never the lab target{' '}
              <span className="font-mono text-foreground">
                {view.targetTag}
              </span>
              , and never an input tag
            </>
          )}
          . Each is checked in PI when you save.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <TagField
          id="wb-prediction-tag"
          label="Prediction output tag"
          value={prediction}
          onChange={setPrediction}
          sourceId={sourceId}
        />
        <TagField
          id="wb-lab-tag"
          label="Lab output tag (corrected lab values)"
          value={lab}
          onChange={setLab}
          sourceId={sourceId}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || !sourceId}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? 'Checking in PI…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** MODEL-SERVE-032. Set the model's PI output tags (owner / admin only). */
export function WriteBackConfigDialog({
  open,
  onOpenChange,
  view,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: WriteBackConfigView | null
  onSave: (tags: {
    predictionTag: string | null
    labTag: string | null
  }) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the fields restart from the saved
            tags every time rather than keeping an abandoned edit. */}
        {open && view && (
          <Form
            view={view}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
