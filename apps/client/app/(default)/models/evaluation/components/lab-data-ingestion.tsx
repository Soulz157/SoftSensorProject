'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileUp, Plus, Trash2, X } from 'lucide-react'
import { DateTimePicker } from '@/components/ui/Datetime'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LabPoint } from '@/lib/lab-ingestion'

const fmtTs = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

interface Props {
  draftLab: LabPoint[]
  isDirty: boolean
  appliedCount: number
  /** Applied points that aligned to a prediction within tolerance. */
  alignedCount: number
  addLabPoint: (point: LabPoint) => void
  removeDraftPoint: (index: number) => void
  importCsv: (text: string) => { added: number; errors: string[] }
  apply: () => void
  clearLab: () => void
}

export function LabDataIngestion({
  draftLab,
  isDirty,
  appliedCount,
  alignedCount,
  addLabPoint,
  removeDraftPoint,
  importCsv,
  apply,
  clearLab,
}: Props) {
  const [ts, setTs] = useState('')
  const [value, setValue] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const ms = Date.parse(ts)
    if (!ts || Number.isNaN(ms)) {
      toast.error('Pick a valid timestamp')
      return
    }
    const v = Number(value)
    if (value.trim() === '' || !Number.isFinite(v)) {
      toast.error('Enter a numeric lab result value')
      return
    }
    addLabPoint({ timestamp: new Date(ms).toISOString(), value: v })
    setTs('')
    setValue('')
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    const text = await file.text()
    const { added, errors } = importCsv(text)
    if (added > 0) {
      toast.success(`Imported ${added} lab point${added === 1 ? '' : 's'}`)
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} row(s) skipped — ${errors[0]}`)
    }
    if (added === 0 && errors.length === 0) {
      toast.error('No data rows found in file')
    }
  }

  const handleApply = () => {
    apply()
    toast.success(
      draftLab.length === 0 ? 'Cleared comparison' : 'Comparison updated',
    )
  }

  const dropped = appliedCount - alignedCount

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Laboratory Data Ingestion{' '}
              <span className="text-foreground/70">(Ground Truth)</span>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add measured lab results to compare against model predictions.
            </p>
          </div>
          {draftLab.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={clearLab}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>

        {/* Entry row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label
              htmlFor="lab-ts"
              className="text-xs font-medium text-muted-foreground"
            >
              Timestamp
            </Label>
            <DateTimePicker
              id="lab-ts"
              value={ts}
              onChange={val => setTs(val)}
              className="h-9"
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label
              htmlFor="lab-value"
              className="text-xs font-medium text-muted-foreground"
            >
              Lab Result Value
            </Label>
            <Input
              id="lab-value"
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="e.g. 72.4"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="h-9 font-mono"
            />
          </div>
          <Button className="h-9 gap-1.5" onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add New Point
          </Button>
        </div>

        {/* CSV upload */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileUp className="h-3.5 w-3.5" />
            Or upload data (CSV)
            <span className="text-[11px] text-muted-foreground/70">
              — columns: timestamp, value
            </span>
          </button>
        </div>

        {/* Draft points */}
        {draftLab.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draftLab.map((p, i) => (
              <span
                key={`${p.timestamp}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
              >
                <span className="text-muted-foreground">
                  {fmtTs(p.timestamp)}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {p.value}
                </span>
                <button
                  type="button"
                  onClick={() => removeDraftPoint(i)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="Remove point"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Apply */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="text-xs text-muted-foreground">
            <p>
              {draftLab.length === 0
                ? 'No lab points added yet.'
                : `${draftLab.length} point${draftLab.length === 1 ? '' : 's'} in draft${
                    appliedCount > 0
                      ? ` · ${alignedCount} of ${appliedCount} applied aligned to predictions`
                      : ''
                  }`}
            </p>
            {dropped > 0 && (
              <p className="mt-0.5 text-amber-500">
                {dropped} applied point{dropped === 1 ? '' : 's'} fell outside
                the selected range/tolerance and{' '}
                {dropped === 1 ? 'was' : 'were'} not compared.
              </p>
            )}
          </div>
          <Button
            onClick={handleApply}
            disabled={draftLab.length === 0 && appliedCount === 0}
          >
            Apply and Compare
            {isDirty && draftLab.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
