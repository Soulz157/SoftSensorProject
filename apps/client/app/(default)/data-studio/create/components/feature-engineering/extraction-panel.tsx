'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  featureColumnName,
  type DatetimePart,
  type FeatureConfig,
  type RollingAgg,
} from '@/lib/feature-engineering'

type Method = 'lag' | 'rolling' | 'datetime'

const AGG_OPTIONS: RollingAgg[] = ['mean', 'std', 'min', 'max', 'ROC']
const PART_OPTIONS: { value: DatetimePart; label: string }[] = [
  { value: 'hour', label: 'Hour of day' },
  { value: 'dayOfWeek', label: 'Day of week' },
  { value: 'month', label: 'Month' },
]

interface Props {
  sourceColumns: string[]
  features: FeatureConfig[]
  onAdd: (cfg: FeatureConfig) => void
  onRemove: (id: string) => void
}

/** Feature Extraction — lag, rolling-window, and datetime-part features. */
export function ExtractionPanel({
  sourceColumns,
  features,
  onAdd,
  onRemove,
}: Props) {
  const [method, setMethod] = useState<Method>('lag')
  const [tag, setTag] = useState('')
  const [k, setK] = useState(1)
  const [window, setWindow] = useState(3)
  const [agg, setAgg] = useState<RollingAgg>('mean')
  const [part, setPart] = useState<DatetimePart>('hour')

  const needsTag = method !== 'datetime'
  const canAdd = !needsTag || (tag !== '' && sourceColumns.includes(tag))

  const build = (): FeatureConfig => {
    const id = crypto.randomUUID()
    if (method === 'lag') return { id, kind: 'lag', tag, k }
    if (method === 'rolling') return { id, kind: 'rolling', tag, window, agg }
    return { id, kind: 'datetime', part }
  }

  const preview = canAdd
    ? featureColumnName({ ...build(), id: 'preview' })
    : '—'

  const extracted = features.filter(
    f => f.kind === 'lag' || f.kind === 'rolling' || f.kind === 'datetime',
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Feature Extraction</CardTitle>
        <CardDescription>
          Derive lagged, rolling-window, or calendar features.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Method</Label>
            <Select value={method} onValueChange={v => setMethod(v as Method)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lag">Lag</SelectItem>
                <SelectItem value="rolling">Rolling window</SelectItem>
                <SelectItem value="datetime">Datetime part</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsTag && (
            <div className="space-y-1.5">
              <Label className="text-xs">Source column</Label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {sourceColumns.map(c => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {method === 'lag' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Lag (k)</Label>
              <Input
                type="number"
                min={1}
                className="h-9"
                value={k}
                onChange={e => setK(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          )}

          {method === 'rolling' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Window</Label>
                <Input
                  type="number"
                  min={2}
                  className="h-9"
                  value={window}
                  onChange={e =>
                    setWindow(Math.max(2, Number(e.target.value) || 2))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Aggregate</Label>
                <Select
                  value={agg}
                  onValueChange={v => setAgg(v as RollingAgg)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGG_OPTIONS.map(a => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {method === 'datetime' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Part</Label>
              <Select
                value={part}
                onValueChange={v => setPart(v as DatetimePart)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PART_OPTIONS.map(p => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">
            New column:{' '}
            <span className="font-mono text-foreground">{preview}</span>
          </p>
          <Button size="sm" disabled={!canAdd} onClick={() => onAdd(build())}>
            <Plus className="h-3.5 w-3.5" />
            Add feature
          </Button>
        </div>

        {extracted.length > 0 && (
          <ul className="space-y-1.5">
            {extracted.map(f => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="font-mono text-xs">
                  {featureColumnName(f)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onRemove(f.id)}
                  aria-label={`Remove ${featureColumnName(f)}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
