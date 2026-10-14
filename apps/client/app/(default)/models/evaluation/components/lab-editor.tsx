'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileUp, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { CalendarDateTimePicker } from '@/components/calendar-date-time-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { stampToUtcIso, utcToWallMs } from '@/lib/backfill-compare'
import { formatWallClockFull } from '@/lib/monitoring'
import type { LabOrigin, LabRow } from '@/lib/backfill-lab'
import type { LabPoint } from '@/lib/lab-ingestion'

interface Props {
  rows: LabRow[]
  /** Edited + added + removed. */
  changes: number
  /** Lab values that found a prediction within tolerance. */
  pairedCount: number
  /** The imported range, as plant-time stamps: added points stay inside it. */
  rangeFrom: string
  rangeTo: string
  onAdd: (point: LabPoint) => void
  onEdit: (timestamp: string, value: number) => void
  onRemove: (timestamp: string) => void
  onRestore: (timestamp: string) => void
  onCsv: (text: string) => { added: number; errors: string[] }
  onReset: () => void
}

const ORIGIN_LABEL: Record<LabOrigin, string> = {
  imported: 'Imported',
  edited: 'Edited',
  added: 'Added',
}

/**
 * MODEL-SERVE-032. The lab series behind the comparison, editable. Starts as
 * the raw recorded lab events; a corrected value, a removed one or an added
 * one all show here marked as such, and the chart and metrics follow at once
 * (no "apply" step). "Reset" returns to what the data source recorded.
 *
 * Origin is shown with a label, never by colour alone.
 */
export function LabEditor({
  rows,
  changes,
  pairedCount,
  rangeFrom,
  rangeTo,
  onAdd,
  onEdit,
  onRemove,
  onRestore,
  onCsv,
  onReset,
}: Props) {
  const [stamp, setStamp] = useState('')
  const [value, setValue] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const active = rows.filter(r => !r.removed).length

  const handleAdd = () => {
    const iso = stampToUtcIso(stamp)
    if (!iso) {
      toast.error('Pick a timestamp')
      return
    }
    const v = Number(value)
    if (value.trim() === '' || !Number.isFinite(v)) {
      toast.error('Enter a numeric lab result')
      return
    }
    onAdd({ timestamp: iso, value: v })
    setStamp('')
    setValue('')
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    const { added, errors } = onCsv(await file.text())
    if (added > 0) {
      toast.success(`Added ${added} lab point${added === 1 ? '' : 's'}`)
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} row(s) skipped — ${errors[0]}`)
    }
    if (added === 0 && errors.length === 0) {
      toast.error('No data rows found in file')
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lab values
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recorded lab results from the data source. Correct, remove or add
              values; the comparison updates as you edit.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {active} in use · {pairedCount} paired with a prediction
              {changes > 0 && ` · ${changes} changed from the source`}
            </p>
          </div>
          {changes > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={onReset}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to source
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label
              htmlFor="lab-add-ts"
              className="text-xs text-muted-foreground"
            >
              Timestamp (plant time)
            </Label>
            <CalendarDateTimePicker
              id="lab-add-ts"
              label="Lab point timestamp"
              value={stamp}
              onChange={setStamp}
              dataBounds={null}
              allowed={{ min: rangeFrom, max: rangeTo }}
              defaultTime="00:00"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="lab-add-value"
              className="text-xs text-muted-foreground"
            >
              Lab result
            </Label>
            <Input
              id="lab-add-value"
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="e.g. 72.4"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="h-8 w-36 font-mono"
            />
          </div>
          <Button className="h-8 gap-1.5" onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add point
          </Button>
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => void handleFile(e)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileUp className="h-3.5 w-3.5" />
            Or upload data (CSV)
            <span className="text-[11px] text-muted-foreground/70">
              — columns: timestamp, value (plant time unless it carries a zone)
            </span>
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The data source recorded no lab values in this range. Add points or
            upload a CSV to compare.
          </p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time (plant)</TableHead>
                  <TableHead className="w-40">Value</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <LabRowView
                    key={`${r.timestamp}|${r.value}|${r.removed}`}
                    row={r}
                    onEdit={onEdit}
                    onRemove={onRemove}
                    onRestore={onRestore}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LabRowView({
  row,
  onEdit,
  onRemove,
  onRestore,
}: {
  row: LabRow
  onEdit: (timestamp: string, value: number) => void
  onRemove: (timestamp: string) => void
  onRestore: (timestamp: string) => void
}) {
  const when = formatWallClockFull(utcToWallMs(row.timestamp))
  const commit = (text: string) => {
    const v = Number(text)
    if (text.trim() !== '' && Number.isFinite(v) && v !== row.value) {
      onEdit(row.timestamp, v)
    }
  }

  return (
    <TableRow className={row.removed ? 'text-muted-foreground' : undefined}>
      <TableCell className="tabular-nums">
        <span className={row.removed ? 'line-through' : undefined}>{when}</span>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          aria-label={`Lab value at ${when}`}
          defaultValue={row.value}
          disabled={row.removed}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="h-7 font-mono"
        />
        {row.origin === 'edited' && row.originalValue !== null && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            source: {row.originalValue}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="font-normal">
          {row.removed ? 'Removed' : ORIGIN_LABEL[row.origin]}
        </Badge>
      </TableCell>
      <TableCell>
        {row.removed ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Restore lab value at ${when}`}
            onClick={() => onRestore(row.timestamp)}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            aria-label={`Remove lab value at ${when}`}
            onClick={() => onRemove(row.timestamp)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
