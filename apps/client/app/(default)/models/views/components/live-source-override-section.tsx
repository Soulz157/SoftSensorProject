'use client'

import { useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CAL_BASIS_OPTIONS, SUMMARY_TYPE_OPTIONS } from '@/lib/fetch-config'
import {
  filterMappingRows,
  type MappingFilter,
  type MappingRow,
} from '@/lib/live-source-mapping'
import type { UseLiveSourceOverrideResult } from '@/hooks/model/use-live-source-override'

interface Props {
  override: UseLiveSourceOverrideResult
  disabled: boolean
}

/**
 * MODEL-SERVE-037-T05. Live PI source + column-to-tag table for a model
 * trained on an uploaded CSV. Laid out like the feature preset Apply
 * Mapping sheet: Matched / Missing pills, search, an All / Matched / Needs
 * attention filter, and a tag field on every row that needs one.
 */
export function LiveSourceOverrideSection({ override, disabled }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MappingFilter>('all')
  const { form, rows, summary } = override
  const visible = filterMappingRows(rows, filter, search)

  if (override.columnsUnavailable) {
    return (
      <p className="text-xs text-muted-foreground">
        The training columns of this model could not be read, so there is
        nothing to map yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">PI source</Label>
        <Select
          value={form.sourceId ?? undefined}
          onValueChange={override.setSourceId}
          disabled={disabled || override.sourcesLoading}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                override.sourcesLoading
                  ? 'Loading sources…'
                  : override.sources.length === 0
                    ? 'No PI source is shared with this workspace'
                    : 'Select a PI source'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {override.sources.map(s => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Only PI sources shared with this model&apos;s workspace can be used.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="live-interval" className="text-xs">
            Interval
          </Label>
          <Input
            id="live-interval"
            value={form.intervalTime}
            onChange={e => override.setFetch({ intervalTime: e.target.value })}
            placeholder="1m"
            disabled={disabled}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Calculation</Label>
          <Select
            value={form.calcType}
            onValueChange={v => override.setFetch({ calcType: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUMMARY_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Basis</Label>
          <Select
            value={form.calcBasis}
            onValueChange={v => override.setFetch({ calcBasis: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAL_BASIS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {form.sourceId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">
              Column-to-tag mapping
            </span>
            <span className="text-muted-foreground">
              {override.checking ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking tags in PI…
                </span>
              ) : (
                `${summary.matched} of ${rows.length} matched`
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search columns or tags…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-8 pr-8 text-xs"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
              {(
                [
                  ['all', `All (${rows.length})`],
                  ['matched', `Matched (${summary.matched})`],
                  [
                    'attention',
                    `Needs attention (${rows.length - summary.matched})`,
                  ],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    'whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors',
                    filter === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {override.checkError && (
            <p className="text-xs text-red-500">{override.checkError}</p>
          )}

          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-24" />
                <col />
                <col />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-2 pl-3 font-medium">Status</th>
                  <th className="p-2 font-medium">Training column</th>
                  <th className="p-2 pr-3 font-medium">PI tag</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <MappingTableRow
                    key={row.column}
                    row={row}
                    disabled={disabled}
                    onTag={tag => override.setTag(row.column, tag)}
                  />
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-muted-foreground">
                      No columns match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {summary.ready
              ? 'Every input resolves in PI. The model is not retrained — check its accuracy on live data.'
              : `${summary.attention} input column(s) still need a PI tag.`}
          </p>
        </div>
      )}
    </div>
  )
}

function MappingTableRow({
  row,
  disabled,
  onTag,
}: {
  row: MappingRow
  disabled: boolean
  onTag: (tag: string) => void
}) {
  // A column already found under its own name needs no field; anything
  // missing or remapped keeps one, so a wrong remap can be corrected.
  const editable = row.status === 'missing' || row.remapped
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/30">
      <td className="p-2 pl-3 align-top">
        <StatusPill row={row} />
      </td>
      <td className="p-2 align-top">
        <p className="break-all font-mono text-foreground">{row.column}</p>
        {row.isTarget && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Target — optional, used to match lab results.
          </p>
        )}
      </td>
      <td className="p-2 pr-3 align-top">
        {editable ? (
          <Input
            aria-label={`PI tag for ${row.column}`}
            defaultValue={row.remapped ? row.tag : ''}
            placeholder="Type the PI tag…"
            onBlur={e => onTag(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onTag(e.currentTarget.value)
            }}
            disabled={disabled}
            className="h-7 font-mono text-[11px]"
          />
        ) : (
          <span className="break-all font-mono text-muted-foreground">
            {row.tag}
          </span>
        )}
      </td>
    </tr>
  )
}

/** Colour AND label, never colour alone — same pill as the preset sheet. */
function StatusPill({ row }: { row: MappingRow }) {
  const label =
    row.status === 'matched'
      ? 'Matched'
      : row.status === 'missing'
        ? row.isTarget
          ? 'Not mapped'
          : 'Missing'
        : 'Checking'
  const attention = row.status === 'missing' && !row.isTarget
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        attention
          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          attention ? 'bg-rose-500' : 'bg-muted-foreground/60',
        )}
      />
      {label}
    </span>
  )
}
