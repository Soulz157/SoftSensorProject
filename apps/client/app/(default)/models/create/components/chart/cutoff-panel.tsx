// components/cutoff-panel.tsx
'use client'

import { Plus, Trash2, ChevronDown } from 'lucide-react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CutoffRule, CutoffOp, CutoffMode } from '@/types/cutoff'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

interface Props {
  tags: string[]
  rules: CutoffRule[]
  onAdd: () => void
  onUpdate: <K extends keyof CutoffRule>(
    id: string,
    key: K,
    val: CutoffRule[K],
  ) => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
}

const OPS: CutoffOp[] = ['>', '>=', '<', '<=', '==', '!=']

export function CutoffPanel({
  tags,
  rules,
  onAdd,
  onUpdate,
  onRemove,
  onToggle,
}: Props) {
  const [open, setOpen] = useState(false)
  const activeCount = rules.filter(r => r.enabled).length

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      {/* ── header ── */}
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide',
            'text-muted-foreground transition-colors hover:bg-muted/50',
            open && 'rounded-b-none border-b-transparent bg-muted/30',
          )}
        >
          <span> Data preprocessing</span>
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="h-4 rounded-full px-1.5 text-[10px]"
            >
              {activeCount} active
            </Badge>
          )}
          <ChevronDown
            className={cn(
              'ml-auto h-3.5 w-3.5 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </Collapsible.Trigger>

      {/* ── body ── */}
      <Collapsible.Content>
        <div className="rounded-b-lg border border-t-0 bg-background p-3 space-y-2">
          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">
              No rules yet — add one to highlight or clip data by condition.
            </p>
          )}

          {rules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              tags={tags}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onToggle={onToggle}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-dashed text-xs"
            onClick={onAdd}
          >
            <Plus className="mr-1 h-3 w-3" /> Add rule
          </Button>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/* ── single rule row ──────────────────────────────────────────── */
function RuleRow({
  rule,
  tags,
  onUpdate,
  onRemove,
  onToggle,
}: {
  rule: CutoffRule
  tags: string[]
  onUpdate: Props['onUpdate']
  onRemove: Props['onRemove']
  onToggle: Props['onToggle']
}) {
  return (
    <div
      className={cn(
        'grid items-center gap-2 rounded-md border px-2.5 py-2 transition-opacity',
        'grid-cols-[1fr_56px_80px_auto_auto]',
      )}
    >
      <div className="flex col-2 gap-4 items-center">
        {/* tag */}
        <Select
          value={rule.tag}
          onValueChange={v => onUpdate(rule.id, 'tag', v)}
        >
          <SelectTrigger className="h-7 text-xs font-mono">
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

        {/* operator */}
        <Select
          value={rule.op}
          onValueChange={v => onUpdate(rule.id, 'op', v as CutoffOp)}
        >
          <SelectTrigger className="h-7 text-xs font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPS.map(op => (
              <SelectItem key={op} value={op} className="font-mono text-xs">
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* threshold value */}
        <Input
          type="number"
          step="any"
          placeholder="Value"
          value={rule.value}
          onChange={e =>
            onUpdate(
              rule.id,
              'value',
              e.target.value === '' ? '' : parseFloat(e.target.value),
            )
          }
          className="h-7 text-xs w-20 font-mono"
        />

        <div className="flex items-center gap-4 shrink-0">
          <Switch
            type="button"
            title={rule.enabled ? 'Disable rule' : 'Enable rule'}
            onCheckedChange={() => onToggle(rule.id)}
            className={cn(
              'h-5 w-9 rounded-full border transition-colors relative',
              rule.enabled ? 'bg-primary ' : ' border-border',
            )}
          />
          {rule.enabled ? (
            <Badge className="bg-primary">ON</Badge>
          ) : (
            <Badge className="bg-primary">OFF</Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRemove(rule.id)}
            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <ToggleGroup
        type="single"
        value={rule.mode}
        onValueChange={v => {
          if (v) onUpdate(rule.id, 'mode', v as CutoffMode)
        }}
        className="h-7 rounded-md border overflow-hidden gap-0"
      >
        <ToggleGroupItem
          value="highlight"
          className={cn(
            'h-7 rounded-none px-2.5 text-[10px] font-semibold uppercase tracking-wider',
            'data-[state=on]:bg-amber-500/80 data-[state=on]:text-white',
          )}
        >
          ⚠ HL
        </ToggleGroupItem>
        <ToggleGroupItem
          value="clip"
          className={cn(
            'h-7 rounded-none border-l px-2.5 text-[10px] font-semibold uppercase tracking-wider',
            'data-[state=on]:bg-destructive/80 data-[state=on]:text-white',
          )}
        >
          ✂ Clip
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}
