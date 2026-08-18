'use client'

import { nanoid } from 'nanoid'
import { Filter, Plus, Sigma, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type { CutoffOp } from '@/types/cutoff'
import type { Dataset } from '@/lib/preprocessing'
import {
  statisticalMatchCount,
  type ConditionalRule,
  type OutlierAction,
  type StatisticalMethod,
  type StatisticalRule,
} from '@/lib/precleanse'

const OPS: CutoffOp[] = ['>', '>=', '<', '<=', '==', '!=']
const METHODS: { value: StatisticalMethod; label: string }[] = [
  { value: 'zscore', label: 'Z-Score' },
  { value: 'stddev', label: 'Std Dev' },
]

interface Props {
  /** Full tag catalog (rule targets). */
  tags: string[]
  /** Cropped dataset (pre-outlier) — basis for the live "points affected" count. */
  previewDataset: Dataset
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  onStatisticalChange: (rules: StatisticalRule[]) => void
}

/** mark cell Bad (fillable in 5.2) vs drop the whole row. */
function ActionToggle({
  value,
  onChange,
}: {
  value: OutlierAction
  onChange: (a: OutlierAction) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => v && onChange(v as OutlierAction)}
      className="h-7 shrink-0 overflow-hidden rounded-md border"
    >
      <ToggleGroupItem
        value="mark"
        className="h-7 rounded-none px-2.5 text-[10px] font-semibold tracking-wider uppercase data-[state=on]:bg-amber-500/80 data-[state=on]:text-white"
      >
        Mark
      </ToggleGroupItem>
      <ToggleGroupItem
        value="drop"
        className="h-7 rounded-none border-l px-2.5 text-[10px] font-semibold tracking-wider uppercase data-[state=on]:bg-destructive/80 data-[state=on]:text-white"
      >
        Drop
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function OutlierRemovalPanel({
  tags,
  previewDataset,
  conditionalRules,
  statisticalRules,
  onConditionalChange,
  onStatisticalChange,
}: Props) {
  const firstTag = tags[0] ?? ''

  const addConditional = () =>
    onConditionalChange([
      ...conditionalRules,
      {
        id: nanoid(6),
        tag: firstTag,
        op: '>',
        value: '',
        action: 'mark',
        enabled: true,
      },
    ])
  const updateConditional = (id: string, patch: Partial<ConditionalRule>) =>
    onConditionalChange(
      conditionalRules.map(r => (r.id === id ? { ...r, ...patch } : r)),
    )
  const removeConditional = (id: string) =>
    onConditionalChange(conditionalRules.filter(r => r.id !== id))

  const addStatistical = () =>
    onStatisticalChange([
      ...statisticalRules,
      {
        id: nanoid(6),
        tag: 'ALL',
        method: 'zscore',
        threshold: 3,
        action: 'mark',
        enabled: true,
      },
    ])
  const updateStatistical = (id: string, patch: Partial<StatisticalRule>) =>
    onStatisticalChange(
      statisticalRules.map(r => (r.id === id ? { ...r, ...patch } : r)),
    )
  const removeStatistical = (id: string) =>
    onStatisticalChange(statisticalRules.filter(r => r.id !== id))

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Data Cutting &amp; Outlier Removal
        </p>
      </div>

      <Tabs defaultValue="conditional" className="flex w-full flex-col">
        <TabsList className="mb-4 inline-flex w-fit">
          <TabsTrigger value="conditional" className="gap-2">
            <Filter className="h-3.5 w-3.5" /> Conditional
          </TabsTrigger>
          <TabsTrigger value="statistical">
            <Sigma className="h-3.5 w-3.5" /> Statistical
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conditional" className="space-y-2">
          {conditionalRules.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">
              No rules — add one to cut readings by a value condition (e.g.{' '}
              <span className="font-mono">Value &gt; 1000</span>).
            </p>
          )}
          {conditionalRules.map(rule => (
            <div
              key={rule.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2',
                !rule.enabled && 'opacity-60',
              )}
            >
              <Select
                value={rule.tag}
                onValueChange={v => updateConditional(rule.id, { tag: v })}
              >
                <SelectTrigger className="h-7 w-36 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tags.map(t => (
                    <SelectItem key={t} value={t} className="font-mono text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={rule.op}
                onValueChange={v =>
                  updateConditional(rule.id, { op: v as CutoffOp })
                }
              >
                <SelectTrigger className="h-7 w-16 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPS.map(op => (
                    <SelectItem
                      key={op}
                      value={op}
                      className="font-mono text-xs"
                    >
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="any"
                placeholder="Value"
                value={rule.value}
                onChange={e =>
                  updateConditional(rule.id, {
                    value:
                      e.target.value === '' ? '' : parseFloat(e.target.value),
                  })
                }
                className="h-7 w-24 font-mono text-xs"
              />
              <ActionToggle
                value={rule.action}
                onChange={a => updateConditional(rule.id, { action: a })}
              />
              <div className="ml-auto flex items-center gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={c =>
                    updateConditional(rule.id, { enabled: c })
                  }
                  aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete rule"
                  onClick={() => removeConditional(rule.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-xs"
            onClick={addConditional}
            disabled={tags.length === 0}
          >
            <Plus className="mr-1 h-3 w-3" /> Add condition
          </Button>
        </TabsContent>

        {/* ── Method B: statistical thresholds ── */}
        <TabsContent value="statistical" className="space-y-2">
          {statisticalRules.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">
              No rules — add one to auto-remove values beyond N standard
              deviations from the mean.
            </p>
          )}
          {statisticalRules.map(rule => {
            const affected = rule.enabled
              ? statisticalMatchCount(previewDataset, rule)
              : 0
            return (
              <div
                key={rule.id}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2',
                  !rule.enabled && 'opacity-60',
                )}
              >
                <Select
                  value={rule.tag}
                  onValueChange={v => updateStatistical(rule.id, { tag: v })}
                >
                  <SelectTrigger className="h-7 w-36 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL" className="text-xs">
                      All tags
                    </SelectItem>
                    {tags.map(t => (
                      <SelectItem
                        key={t}
                        value={t}
                        className="font-mono text-xs"
                      >
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={rule.method}
                  onValueChange={v =>
                    updateStatistical(rule.id, {
                      method: v as StatisticalMethod,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map(m => (
                      <SelectItem
                        key={m.value}
                        value={m.value}
                        className="text-xs"
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground">±</span>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={rule.threshold}
                    onChange={e =>
                      updateStatistical(rule.id, {
                        threshold: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="h-7 w-16 font-mono text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">σ</span>
                </div>
                <ActionToggle
                  value={rule.action}
                  onChange={a => updateStatistical(rule.id, { action: a })}
                />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {affected} pts
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={c =>
                      updateStatistical(rule.id, { enabled: c })
                    }
                    aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete rule"
                    onClick={() => removeStatistical(rule.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-xs"
            onClick={addStatistical}
            disabled={tags.length === 0}
          >
            <Plus className="mr-1 h-3 w-3" /> Add threshold
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  )
}
