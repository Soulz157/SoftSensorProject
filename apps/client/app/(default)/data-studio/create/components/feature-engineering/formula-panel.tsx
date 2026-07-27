'use client'

import { useMemo, useRef, useState } from 'react'
import { Plus, X, Variable } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { validateFormula } from '@/lib/formula'
import {
  featureColumnName,
  type FeatureConfig,
} from '@/lib/feature-engineering'

const OPS = ['+', '-', '*', '/', '(', ')'] as const
const aliasOf = (i: number) => String.fromCharCode(65 + i)

interface Slot {
  alias: string
  tag: string
}

interface Props {
  sourceColumns: string[]
  features: FeatureConfig[]
  onAdd: (cfg: FeatureConfig) => void
  onRemove: (id: string) => void
}

export function FormulaPanel({
  sourceColumns,
  features,
  onAdd,
  onRemove,
}: Props) {
  const [slots, setSlots] = useState<Slot[]>([{ alias: 'A', tag: '' }])
  const [expr, setExpr] = useState('')
  const [name, setName] = useState('')
  const exprRef = useRef<HTMLTextAreaElement | null>(null)

  const vars = useMemo(
    () =>
      Object.fromEntries(slots.filter(s => s.tag).map(s => [s.alias, s.tag])),
    [slots],
  )
  const check = useMemo(
    () => validateFormula(expr, vars, sourceColumns),
    [expr, vars, sourceColumns],
  )

  const addSlot = () =>
    setSlots(s => [...s, { alias: aliasOf(s.length), tag: '' }])
  const setTag = (i: number, tag: string) =>
    setSlots(s => s.map((sl, idx) => (idx === i ? { ...sl, tag } : sl)))
  const removeSlot = (i: number) =>
    setSlots(s =>
      s
        .filter((_, idx) => idx !== i)
        .map((sl, idx) => ({ ...sl, alias: aliasOf(idx) })),
    )

  // แทรก token ตรงตำแหน่ง cursor
  const insert = (tok: string) => {
    const el = exprRef.current
    if (!el) return setExpr(e => e + tok)
    const { selectionStart: a, selectionEnd: b } = el
    setExpr(expr.slice(0, a) + tok + expr.slice(b))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + tok.length, a + tok.length)
    })
  }

  const build = (): FeatureConfig => ({
    id: crypto.randomUUID(),
    kind: 'formula',
    name: name.trim() || undefined,
    expr: expr.trim(),
    vars,
  })

  const preview = check.ok ? name.trim() || expr.trim() : '—'
  const list = features.filter(f => f.kind === 'formula')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Formula Feature</CardTitle>
        <CardDescription>
          Map columns to variables, then type any expression — supports{' '}
          <span className="font-mono">+ − × ÷</span> and parentheses, e.g.{' '}
          <span className="font-mono">(A + B) - (B + C)</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Variable slots (dynamic) ── */}
        <div className="space-y-2">
          <Label className="text-xs">Variables</Label>
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono text-sm font-semibold">
                {s.alias}
              </span>
              <span className="text-muted-foreground">=</span>
              <Select value={s.tag} onValueChange={v => setTag(i, v)}>
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
              {slots.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  onClick={() => removeSlot(i)}
                  aria-label={`Remove ${s.alias}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={addSlot}
            disabled={slots.length >= 26}
          >
            <Variable className="h-3.5 w-3.5" />
            Add variable
          </Button>
        </div>

        {/* ── Expression ── */}
        <div className="space-y-1.5">
          <Label className="text-xs">Expression</Label>
          <div className="flex flex-wrap gap-1.5">
            {OPS.map(op => (
              <Button
                key={op}
                size="sm"
                variant="secondary"
                className="h-7 w-8 font-mono"
                onClick={() => insert(op)}
              >
                {op}
              </Button>
            ))}
          </div>
          <Textarea
            ref={exprRef}
            value={expr}
            onChange={e => setExpr(e.target.value)}
            placeholder="(A + B) - (B + C)"
            rows={2}
            spellCheck={false}
            className="font-mono text-sm"
          />
          {expr.trim() && !check.ok && (
            <p className="text-[11px] text-destructive">{check.error}</p>
          )}
        </div>

        {/* ── Optional output name ── */}
        <div className="space-y-1.5">
          <Label className="text-xs">Output column name (optional)</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. balance_delta"
            className="h-9 font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">
            New column:{' '}
            <span className="font-mono text-foreground">{preview}</span>
          </p>
          <Button
            size="sm"
            disabled={!check.ok}
            onClick={() => {
              onAdd(build())
              setExpr('')
              setName('')
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add feature
          </Button>
        </div>

        {list.length > 0 && (
          <ul className="space-y-1.5">
            {list.map(f => (
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
