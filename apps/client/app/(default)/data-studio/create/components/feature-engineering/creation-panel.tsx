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
  type ArithOp,
  type FeatureConfig,
} from '@/lib/feature-engineering'

type Op = ArithOp | 'div' | 'log'

const OP_OPTIONS: {
  value: Op
  label: string
  glyph: string
  unary: boolean
}[] = [
  { value: 'add', label: 'Add', glyph: '+', unary: false },
  { value: 'sub', label: 'Subtract', glyph: '−', unary: false },
  { value: 'mul', label: 'Multiply', glyph: '×', unary: false },
  { value: 'div', label: 'Divide', glyph: '÷', unary: false },
  { value: 'log', label: 'Log (ln)', glyph: 'ln', unary: true },
]

interface Props {
  sourceColumns: string[]
  features: FeatureConfig[]
  onAdd: (cfg: FeatureConfig) => void
  onRemove: (id: string) => void
}

/**
 * Feature Creation — n-ary math features from existing columns.
 * Operands are a growable row list (add/mul/sub/div fold left-to-right over
 * `tags`; log is unary). Requires the n-ary FeatureConfig contract — see notes.
 */
export function CreationPanel({
  sourceColumns,
  features,
  onAdd,
  onRemove,
}: Props) {
  const [op, setOp] = useState<Op>('add')
  const [tags, setTags] = useState<string[]>(['', ''])

  const opMeta = OP_OPTIONS.find(o => o.value === op)!
  const unary = opMeta.unary
  const minOperands = unary ? 1 : 2

  // op change: log collapses to a single operand; binary ensures >= 2 rows.
  const changeOp = (next: Op) => {
    const nextUnary = OP_OPTIONS.find(o => o.value === next)?.unary ?? false
    setOp(next)
    setTags(prev =>
      nextUnary
        ? [prev[0] ?? '']
        : prev.length >= 2
          ? prev
          : [...prev, ...Array(2 - prev.length).fill('')],
    )
  }

  const setOperand = (i: number, v: string) =>
    setTags(prev => prev.map((t, idx) => (idx === i ? v : t)))
  const addOperand = () => setTags(prev => [...prev, ''])
  const removeOperand = (i: number) =>
    setTags(prev => prev.filter((_, idx) => idx !== i))

  const allFilled = tags.every(t => t !== '' && sourceColumns.includes(t))
  const canAdd = allFilled && tags.length >= minOperands

  const build = (id: string, chosen: string[]): FeatureConfig => {
    if (op === 'log') return { id, kind: 'log', tag: chosen[0]! }
    if (op === 'div') return { id, kind: 'ratio', tags: chosen }
    return { id, kind: 'arith', op: op as ArithOp, tags: chosen }
  }

  const previewName = canAdd ? featureColumnName(build('preview', tags)) : ''

  const handleAdd = () => {
    if (!canAdd) return
    onAdd(build(crypto.randomUUID(), tags))
    setTags(unary ? [''] : ['', '']) // clean slate for the next feature
  }

  const created = features.filter(
    f => f.kind === 'arith' || f.kind === 'ratio' || f.kind === 'log',
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Feature Creation</CardTitle>
        <CardDescription>
          Combine columns with math operations into a new feature.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Operation — isolated from operands (Proximity) */}
        <div className="space-y-1.5 sm:max-w-xs">
          <Label className="text-xs">Operation</Label>
          <Select value={op} onValueChange={v => changeOp(v as Op)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OP_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 text-center font-mono text-muted-foreground">
                      {o.glyph}
                    </span>
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Operands — growable row list reading as a vertical expression */}
        <div className="space-y-1.5">
          <Label className="text-xs">{unary ? 'Operand' : 'Operands'}</Label>
          <div className="space-y-2">
            {tags.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* operator connector: spacer on row 0, glyph on the rest */}
                <div className="flex h-9 w-8 shrink-0 items-center justify-center">
                  {i > 0 && (
                    <span className="font-mono text-sm font-semibold text-primary">
                      {opMeta.glyph}
                    </span>
                  )}
                </div>
                <Select value={t} onValueChange={v => setOperand(i, v)}>
                  <SelectTrigger className="h-9 flex-1">
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeOperand(i)}
                  disabled={unary || tags.length <= minOperands}
                  aria-label={`Remove operand ${i + 1}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {!unary && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addOperand}
              className="ml-10 w-[calc(100%-2.5rem-2.75rem)] border-dashed text-muted-foreground"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add operand
            </Button>
          )}
        </div>

        {/* Preview name (Doherty — instant, no submit needed) */}
        <div className="space-y-1.5">
          <Label className="text-xs">New feature name</Label>
          <Input
            className="h-9 font-mono text-xs"
            value={previewName}
            readOnly
            placeholder="auto-generated"
          />
        </div>

        {/* Primary CTA (Von Restorff) */}
        <div className="flex justify-end border-t border-border/60 pt-3">
          <Button size="sm" disabled={!canAdd} onClick={handleAdd}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add feature
          </Button>
        </div>

        {created.length > 0 && (
          <ul className="space-y-1.5">
            {created.map(f => (
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
