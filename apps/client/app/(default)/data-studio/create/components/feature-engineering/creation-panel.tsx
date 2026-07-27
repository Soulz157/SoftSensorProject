'use client'

import { useMemo, useRef, useState } from 'react'
import { Plus, X, FunctionSquare, Blocks } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import {
  featureColumnName,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import {
  validateFormula,
  tokenizeColumns,
  formulaSegments,
} from '@/lib/formula'

interface Props {
  sourceColumns: string[]
  features: FeatureConfig[]
  onAdd: (cfg: FeatureConfig) => void
  onRemove: (id: string) => void
}

type Mode = 'formula' | 'builder'

/** Chain operators for the visual builder (glyph = display, char = math op). */
const OPS = [
  { char: '+', glyph: '+' },
  { char: '-', glyph: '−' },
  { char: '*', glyph: '×' },
  { char: '/', glyph: '÷' },
] as const
type OpChar = (typeof OPS)[number]['char']

/** One builder operand after the first: an operator + a column. */
interface ChainLink {
  op: OpChar
  col: string
}

const colColor = (col: string) => chartColorVar(resolveTagMeta(col).chartIndex)

/** Column key must be recharts-safe (no dots/spaces) since it becomes a tag. */
function sanitizeName(name: string): string {
  return name.trim().replace(/[.\s]+/g, '_')
}

/**
 * Feature Creation — build a new column from a math expression over existing
 * columns. Two modes both emit a `FormulaFeature` (evaluated downstream by
 * `applyFeatures`): a free-form Formula textarea and a visual chain Builder.
 */
export function CreationPanel({
  sourceColumns,
  features,
  onAdd,
  onRemove,
}: Props) {
  const [mode, setMode] = useState<Mode>('formula')
  const [formula, setFormula] = useState('')
  const [head, setHead] = useState('')
  const [chain, setChain] = useState<ChainLink[]>([{ op: '+', col: '' }])
  const [name, setName] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const created = useMemo(
    () => features.filter(f => f.kind === 'formula'),
    [features],
  )

  // The raw (column-name) expression the active mode produces.
  const rawExpr = useMemo(() => {
    if (mode === 'formula') return formula
    if (!head) return ''
    const parts = [head]
    for (const link of chain) {
      const op = OPS.find(o => o.char === link.op)!
      parts.push(op.char, link.col || '?')
    }
    return parts.join(' ')
  }, [mode, formula, head, chain])

  // Tokenize real column names → engine alias form, then validate.
  const { aliasExpr, vars, unknownTokens } = useMemo(
    () => tokenizeColumns(rawExpr, sourceColumns),
    [rawExpr, sourceColumns],
  )
  const validation = useMemo(() => {
    if (mode === 'builder' && chain.some(l => !l.col))
      return { ok: false as const, error: 'Pick a column for every operand' }
    const base = validateFormula(aliasExpr, vars, sourceColumns)
    if (base.ok) return { ok: true as const }
    if (unknownTokens.length)
      return {
        ok: false as const,
        error: `Unknown column(s): ${unknownTokens.join(', ')}`,
      }
    return { ok: false as const, error: base.error }
  }, [mode, chain, aliasExpr, vars, sourceColumns, unknownTokens])

  const segments = useMemo(
    () => (rawExpr ? formulaSegments(rawExpr, sourceColumns) : []),
    [rawExpr, sourceColumns],
  )

  const finalName = sanitizeName(name) || `feature_${created.length + 1}`
  const canAdd = validation.ok && Boolean(rawExpr.trim())

  const insertColumn = (col: string) => {
    if (mode !== 'formula') return
    const ta = taRef.current
    const pos = ta ? (ta.selectionStart ?? formula.length) : formula.length
    const before = formula.slice(0, pos)
    const after = formula.slice(pos)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${pad}${col} ${after}`
    setFormula(next)
    requestAnimationFrame(() => {
      ta?.focus()
      const caret = (before + pad + col + ' ').length
      ta?.setSelectionRange(caret, caret)
    })
  }

  const setLink = (i: number, patch: Partial<ChainLink>) =>
    setChain(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const addLink = () => setChain(prev => [...prev, { op: '+', col: '' }])
  const removeLink = (i: number) =>
    setChain(prev => prev.filter((_, idx) => idx !== i))

  const reset = () => {
    setFormula('')
    setHead('')
    setChain([{ op: '+', col: '' }])
    setName('')
  }

  const handleAdd = () => {
    if (!canAdd) return
    onAdd({
      id: crypto.randomUUID(),
      kind: 'formula',
      name: finalName,
      display: rawExpr.trim(),
      expr: aliasExpr,
      vars,
    })
    reset()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Feature Creation</CardTitle>
        <CardDescription>
          Build a new column from a math expression over existing columns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Mode toggle */}
        <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setMode('formula')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'formula'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FunctionSquare className="h-3.5 w-3.5" />
            Formula
          </button>
          <button
            type="button"
            onClick={() => setMode('builder')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'builder'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Blocks className="h-3.5 w-3.5" />
            Builder
          </button>
        </div>

        {mode === 'formula' ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Formula</Label>
              <Textarea
                ref={taRef}
                value={formula}
                onChange={e => setFormula(e.target.value)}
                placeholder="(TI-101 + TI-102) - (PI-303 * 2)"
                className="min-h-20 font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Use column names and{' '}
                <span className="font-mono">+ − * / ^ ( )</span>.
              </p>
            </div>

            {/* Live highlight preview */}
            {segments.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-2 font-mono text-xs">
                {segments.map((seg, i) =>
                  seg.kind === 'column' ? (
                    <span
                      key={i}
                      className="rounded px-1.5 py-0.5 font-medium"
                      style={{
                        backgroundColor: `color-mix(in oklab, ${colColor(seg.text)} 18%, transparent)`,
                        color: colColor(seg.text),
                      }}
                    >
                      {seg.text}
                    </span>
                  ) : seg.kind === 'unknown' ? (
                    <span key={i} className="text-destructive">
                      {seg.text}
                    </span>
                  ) : (
                    <span key={i} className="text-muted-foreground">
                      {seg.text}
                    </span>
                  ),
                )}
              </div>
            )}

            {/* Column palette — click to insert */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Insert column
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {sourceColumns.map(col => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => insertColumn(col)}
                    className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted"
                    style={{ color: colColor(col) }}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs">Operands</Label>
            <div className="space-y-2">
              {/* First operand — no leading operator */}
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 shrink-0" />
                <Select value={head} onValueChange={setHead}>
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
                <div className="h-9 w-9 shrink-0" />
              </div>

              {chain.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  {/* operator dropdown BETWEEN operands */}
                  <Select
                    value={link.op}
                    onValueChange={v => setLink(i, { op: v as OpChar })}
                  >
                    <SelectTrigger className="h-9 w-9 justify-center px-0 font-mono text-sm font-semibold text-primary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPS.map(o => (
                        <SelectItem key={o.char} value={o.char}>
                          <span className="font-mono">{o.glyph}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={link.col}
                    onValueChange={v => setLink(i, { col: v })}
                  >
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
                    onClick={() => removeLink(i)}
                    disabled={chain.length <= 1}
                    aria-label={`Remove operand ${i + 2}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addLink}
              className="ml-11 border-dashed text-muted-foreground"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add operand
            </Button>
          </div>
        )}

        {/* Feature name */}
        <div className="space-y-1.5">
          <Label className="text-xs">New feature name</Label>
          <Input
            className="h-9 font-mono text-xs"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={`feature_${created.length + 1}`}
          />
        </div>

        {/* Validation + CTA */}
        <div className="space-y-2 border-t border-border/60 pt-3">
          {rawExpr.trim() && !validation.ok && (
            <p className="text-xs text-destructive">{validation.error}</p>
          )}
          <div className="flex justify-end">
            <Button size="sm" disabled={!canAdd} onClick={handleAdd}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add feature
            </Button>
          </div>
        </div>

        {created.length > 0 && (
          <ul className="space-y-1.5">
            {created.map(f => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">
                    {featureColumnName(f)}
                  </p>
                  {f.kind === 'formula' && f.display && (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      = {f.display}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
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
