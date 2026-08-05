'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import * as Collapsible from '@radix-ui/react-collapsible'
import {
  AlertCircle,
  CalendarOff,
  ChevronDown,
  FileSpreadsheet,
  FlaskConical,
  Loader2,
  Search,
  Target,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { dwSdtaConfigAtom, dwWorkspaceIdAtom } from '@/store/dataset-studio'
import { useFeaturePresets } from '@/hooks/dataset/use-feature-presets'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import type { FeatureConfig } from '@/lib/feature-engineering'
import {
  canApply,
  compareTags,
  requiredDatasetTags,
  toFeatureConfigs,
  type PresetDocument,
  type PresetFeature,
  type PresetSummary,
  type SdtaConfig,
  type TagCheck,
} from '@/lib/feature-preset'

/** What Apply hands to the wizard. Derived here so Step 4 need not re-derive. */
export interface AppliedPreset {
  document: PresetDocument
  /** The picker row this document came from — provenance for dwFeaturePresetAtom. */
  summary: PresetSummary
  /** Equations, queued for Step 4. Nothing is evaluated yet. */
  featureConfigs: FeatureConfig[]
  /** Base tags the preset needs, with overrides applied. */
  requiredTags: string[]
  overrides: Record<string, string>
}

interface Props {
  /** Step-1 rows, NOT tag names — the gate needs each row's status. */
  rows: DatasetTagRow[]
  onApplyPreset: (applied: AppliedPreset) => void
  /**
   * Opt-in — separate from onApplyPreset because SD&TA belongs to the IMPORT,
   * not to whichever preset happens to be selected. A user may want the cut
   * config with no preset chosen at all.
   */
  onApplySdta: (sdta: SdtaConfig) => void
}

type StatusFilter = 'all' | 'matched' | 'attention'

/**
 * Feature Preset Manager.
 *
 * A side sheet rather than a dialog: comparing forty required tags against a
 * dataset while reading equations is a configuration task, and a centred modal
 * forces that into two nested scroll regions.
 *
 * Layout is three fixed zones — header, body, footer — with exactly two
 * independent scroll areas inside the body (the preset column and the
 * comparison table). The sheet itself never scrolls, so the footer and the
 * verification summary stay put while a long tag list moves.
 *
 * Colour follows the tag table next door, not the status palette: `matched` is
 * NEUTRAL, never green. Green/amber/red are reserved for plant operating state
 * (DESIGN.md §2, The Status Contract), and a tag being present is data quality,
 * not an operating condition.
 */
export function PresetApplyManager({
  rows,
  onApplyPreset,
  onApplySdta,
}: Props) {
  const [open, setOpen] = useState(false)
  const workspaceId = useAtomValue(dwWorkspaceIdAtom)
  const {
    presets,
    currentImport,
    loading,
    importing,
    error,
    importWorkbook,
    loadDocument,
    loadSdta,
  } = useFeaturePresets(workspaceId)

  const [unit, setUnit] = useState('')
  const [presetId, setPresetId] = useState('')
  const [document, setDocument] = useState<PresetDocument | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Global, not local: an SD&TA config loaded once is worth keeping around if
  // the sheet is closed and reopened, rather than refetching every time.
  const [sdta, setSdta] = useAtom(dwSdtaConfigAtom)
  const [sdtaLoading, setSdtaLoading] = useState(false)
  const [sdtaError, setSdtaError] = useState<string | null>(null)
  const [sdtaApplied, setSdtaApplied] = useState(false)

  // ── derived ──────────────────────────────────────────────────────────────

  const units = useMemo(
    () => [...new Set(presets.map(p => p.unit))].sort(),
    [presets],
  )

  const configs = useMemo(
    () =>
      presets
        .filter(p => p.unit === unit)
        .sort((a, b) => a.configNo - b.configNo),
    [presets, unit],
  )

  const comparison = useMemo(
    () => (document ? compareTags(document, rows, overrides) : null),
    [document, rows, overrides],
  )

  /** Healthy tags only — remapping onto a broken tag would not help. */
  const mappableTags = useMemo(
    () =>
      rows
        .filter(r => r.status === 'good')
        .map(r => r.tagName)
        .sort(),
    [rows],
  )

  const visibleChecks = useMemo(() => {
    if (!comparison) return []
    const q = search.trim().toLowerCase()
    return comparison.checks.filter(check => {
      if (filter === 'matched' && check.status !== 'matched') return false
      if (filter === 'attention' && check.status === 'matched') return false
      if (!q) return true
      return (
        check.tag.toLowerCase().includes(q) ||
        check.usedIn.some(name => name.toLowerCase().includes(q))
      )
    })
  }, [comparison, search, filter])

  const equations = useMemo(
    () => document?.features.filter(f => f.type === 'equation') ?? [],
    [document],
  )
  const rawTags = useMemo(
    () => document?.features.filter(f => f.type === 'raw_tag') ?? [],
    [document],
  )

  const targetPresent = useMemo(
    () =>
      document
        ? rows.some(r => r.tagName === document.target_y && r.status === 'good')
        : false,
    [document, rows],
  )

  const attention = comparison ? comparison.missing + comparison.unhealthy : 0
  const applicable = Boolean(
    document && comparison && canApply(document, comparison),
  )

  // ── actions ──────────────────────────────────────────────────────────────

  const selectPreset = useCallback(
    async (id: string) => {
      setPresetId(id)
      setDocument(null)
      setDocError(null)
      setOverrides({})
      setDocLoading(true)
      try {
        setDocument(await loadDocument(id))
      } catch (e) {
        setDocError(
          e instanceof Error ? e.message : 'Could not load this preset',
        )
      } finally {
        setDocLoading(false)
      }
    },
    [loadDocument],
  )

  const selectUnit = useCallback((next: string) => {
    setUnit(next)
    setPresetId('')
    setDocument(null)
    setDocError(null)
    setOverrides({})
  }, [])

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const next = await importWorkbook(file)
        toast.success(`Imported ${next.length} preset(s) from ${file.name}`)
        // Land on something usable rather than an empty panel.
        const first = next.find(p => !p.incomplete) ?? next[0]
        if (first) {
          setUnit(first.unit)
          void selectPreset(first.id)
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Import failed')
      }
    },
    [importWorkbook, selectPreset],
  )

  const handleApply = useCallback(() => {
    if (!document || !comparison || !canApply(document, comparison)) return
    // The row this document was loaded from — carries the id/objectKey the
    // wizard's provenance atom needs, which the document itself does not.
    const summary = configs.find(p => p.id === presetId)
    if (!summary) return
    onApplyPreset({
      document,
      summary,
      featureConfigs: toFeatureConfigs(document, overrides),
      requiredTags: requiredDatasetTags(document, overrides),
      overrides,
    })
    toast.success(
      `Applied ${document.name}. ${equations.length} equation(s) queued for Step 4.`,
    )
    setOpen(false)
  }, [
    document,
    comparison,
    overrides,
    equations.length,
    configs,
    presetId,
    onApplyPreset,
  ])

  const loadSdtaConfig = useCallback(async () => {
    if (!currentImport?.sdtaKey) return
    setSdtaLoading(true)
    setSdtaError(null)
    try {
      setSdta(await loadSdta(currentImport.id))
    } catch (e) {
      setSdtaError(
        e instanceof Error ? e.message : 'Could not load the cut config',
      )
    } finally {
      setSdtaLoading(false)
    }
  }, [currentImport, loadSdta, setSdta])

  const handleApplySdta = useCallback(() => {
    if (!sdta) return
    onApplySdta(sdta)
    setSdtaApplied(true)
  }, [sdta, onApplySdta])

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer gap-1.5">
          <Wand2 className="h-3.5 w-3.5" />
          Apply Feature Preset
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-[82vw]! max-w-2xl flex-col sm:max-w-5xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Feature Preset Manager
          </SheetTitle>
          <SheetDescription>
            Import a soft-sensor template, verify its tags against this dataset,
            and queue its equations for Feature Engineering.
          </SheetDescription>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 lg:grid-cols-[400px_1fr]">
          {/* ── LEFT: source + preset ─────────────────────────────────── */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <PresetSource
              currentImport={currentImport}
              importing={importing}
              dragging={dragging}
              setDragging={setDragging}
              fileRef={fileRef}
              onFile={handleFile}
            />

            {/* Independent of preset selection — SD&TA belongs to the IMPORT. */}
            {currentImport?.sdtaKey && (
              <SdtaCard
                sdta={sdta}
                loading={sdtaLoading}
                error={sdtaError}
                applied={sdtaApplied}
                onLoad={loadSdtaConfig}
                onApply={handleApplySdta}
              />
            )}

            {error && <Notice tone="error">{error}</Notice>}

            {!loading && presets.length === 0 && !importing && <EmptyState />}

            {presets.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Unit">
                  <Select value={unit} onValueChange={selectUnit}>
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue placeholder="Select unit…" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map(u => (
                        <SelectItem key={u} value={u} className="text-xs">
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Configuration">
                  <Select
                    value={presetId}
                    onValueChange={id => void selectPreset(id)}
                    disabled={!unit}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue placeholder="Select No.…" />
                    </SelectTrigger>
                    <SelectContent>
                      {configs.map(p => (
                        <SelectItem
                          key={p.id}
                          value={p.id}
                          disabled={p.incomplete}
                          className="text-xs"
                        >
                          No.{p.configNo} — {p.targetY}
                          {p.incomplete && ' (no features)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {unit && configs.some(c => c.incomplete) && (
              <p className="text-xs text-muted-foreground">
                {configs.filter(c => !c.incomplete).length} of {configs.length}{' '}
                configurations in {unit} are usable. The rest name a target but
                list no features in the workbook.
              </p>
            )}

            {docLoading && <LoadingRow />}
            {docError && <Notice tone="error">{docError}</Notice>}

            {document && !docLoading && (
              <PresetPreview
                document={document}
                targetPresent={targetPresent}
                equations={equations}
                rawTags={rawTags}
              />
            )}
          </div>

          {/* ── RIGHT: verification ───────────────────────────────────── */}
          <div className="flex min-h-0 flex-col rounded-xl border border-border">
            {!comparison ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="max-w-xs text-xs text-muted-foreground">
                  Select a preset to check its required tags against this
                  dataset.
                </p>
              </div>
            ) : (
              <>
                <div className="shrink-0 space-y-3 border-b border-border p-3">
                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Required" value={comparison.checks.length} />
                    <Stat label="Matched" value={comparison.matched} />
                    <Stat
                      label="Needs attention"
                      value={attention}
                      alert={attention > 0}
                    />
                    <Stat label="Ready" value={`${comparison.readyPct}%`} />
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search tags or features…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="h-8 pl-8 pr-8 text-xs"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center rounded-md border border-border p-0.5">
                      {(
                        [
                          ['all', `All (${comparison.checks.length})`],
                          ['matched', `Matched (${comparison.matched})`],
                          ['attention', `Needs attention (${attention})`],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFilter(value)}
                          className={cn(
                            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
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
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {visibleChecks.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      No tags match this filter.
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-card">
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="p-2 pl-3 font-medium">Status</th>
                          <th className="p-2 font-medium">Tag</th>
                          <th className="p-2 font-medium">Required by</th>
                          <th className="p-2 pr-3 font-medium">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleChecks.map(check => (
                          <CheckRow
                            key={check.tag}
                            check={check}
                            options={mappableTags}
                            onMap={tag =>
                              setOverrides(prev => ({
                                ...prev,
                                [check.tag]: tag,
                              }))
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {document && comparison && !applicable
              ? document.incomplete
                ? 'This configuration lists no features in the workbook.'
                : `${attention} required tag(s) still need attention.`
              : document
                ? 'All required tags are available.'
                : ''}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!applicable}>
              Apply Mapping
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Stat({
  label,
  value,
  alert,
}: {
  label: string
  value: number | string
  alert?: boolean
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-mono text-base font-medium tabular-nums',
          alert ? 'text-rose-600 dark:text-rose-400' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'info'
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg p-2.5 text-xs',
        tone === 'error'
          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function LoadingRow({ label = 'Loading preset…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium text-foreground">No presets yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Upload a soft-sensor workbook to create them.
      </p>
    </div>
  )
}

/**
 * Opt-in card for the SD&TA (shutdown/turnaround) cut config the workbook may
 * have carried. Independent of the unit/preset selectors above it — this
 * belongs to the import as a whole, not to any one configuration.
 */
function SdtaCard({
  sdta,
  loading,
  error,
  applied,
  onLoad,
  onApply,
}: {
  sdta: SdtaConfig | null
  loading: boolean
  error: string | null
  applied: boolean
  onLoad: () => void
  onApply: () => void
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarOff className="h-3.5 w-3.5" />
        Shutdown / turnaround cut config
      </div>

      {!sdta && !loading && (
        <>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            This workbook includes cut ranges and conditions from an SD&amp;TA
            sheet.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 w-full cursor-pointer text-xs"
            onClick={onLoad}
          >
            Load cut config
          </Button>
        </>
      )}

      {loading && <LoadingRow label="Loading cut config…" />}
      {error && <Notice tone="error">{error}</Notice>}

      {sdta && !loading && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Windows" value={sdta.ranges.length} />
            <Stat label="Conditions" value={sdta.conditions.length} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Applying adds time exclusions and conditional drop rules at Step 3 —
            cleaning is unaffected until you do.
          </p>
          <Button
            size="sm"
            variant={applied ? 'outline' : 'default'}
            disabled={applied}
            className="mt-2 h-7 w-full cursor-pointer text-xs"
            onClick={onApply}
          >
            {applied ? 'Cut config applied' : 'Apply cut config'}
          </Button>
        </>
      )}
    </div>
  )
}

function PresetSource({
  currentImport,
  importing,
  dragging,
  setDragging,
  fileRef,
  onFile,
}: {
  currentImport: { fileName: string; skippedSheets: string[] } | null
  importing: boolean
  dragging: boolean
  setDragging: (v: boolean) => void
  fileRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
}) {
  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm"
        className="hidden"
        onChange={e => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <button
        type="button"
        disabled={importing}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          onFile(e.dataTransfer.files?.[0])
        }}
        className={cn(
          'flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-5 transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/40',
          importing && 'pointer-events-none opacity-60',
        )}
      >
        {importing ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloud className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">
          {importing ? 'Parsing workbook…' : 'Upload workbook'}
        </span>
        <span className="text-xs text-muted-foreground">
          Drop an .xlsx here, or click to browse
        </span>
      </button>

      {currentImport && (
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <p className="truncate font-mono text-xs text-foreground">
            {currentImport.fileName}
          </p>
          {currentImport.skippedSheets.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Skipped (no No/Y/X header):{' '}
              {currentImport.skippedSheets.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PresetPreview({
  document,
  targetPresent,
  equations,
  rawTags,
}: {
  document: PresetDocument
  targetPresent: boolean
  equations: PresetFeature[]
  rawTags: PresetFeature[]
}) {
  return (
    <div className="space-y-3">
      {/* Target — outside the tag gate on purpose, see canApply(). */}
      <div className="rounded-xl border border-border p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          Target variable (Y)
        </div>
        <p className="mt-1.5 font-mono text-sm text-foreground">
          {document.target_y}
        </p>
        {!targetPresent && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
            Not in this dataset. Lab measurements arrive by CSV upload or lab
            ingestion — this does not block applying the preset.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Features" value={document.features.length} />
        <Stat label="Equations" value={equations.length} />
        <Stat label="Raw tags" value={rawTags.length} />
      </div>

      <Collapsible.Root>
        <Collapsible.Trigger className="group flex w-full items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
          <span>Equations ({equations.length})</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content className="space-y-1.5 pt-1.5">
          {equations.map(eq => (
            <div key={eq.name} className="rounded-lg bg-muted/40 p-2.5">
              <p className="font-mono text-xs text-foreground">{eq.name}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                {eq.formula}
              </p>
              {/* Advisory, not an operating state — so muted, not amber.
                  Warning Amber is reserved for plant conditions (DESIGN.md §2). */}
              {eq.parse_warnings.length > 0 && (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  {eq.parse_warnings[0]}
                </p>
              )}
            </div>
          ))}
        </Collapsible.Content>
      </Collapsible.Root>

      {rawTags.length > 0 && (
        <Collapsible.Root>
          <Collapsible.Trigger className="group flex w-full items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium text-foreground">
            <span>Raw tags ({rawTags.length})</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </Collapsible.Trigger>
          <Collapsible.Content className="flex flex-wrap gap-1 pt-1.5">
            {rawTags.map(tag => (
              <span
                key={tag.name}
                className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {tag.name}
              </span>
            ))}
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </div>
  )
}

function CheckRow({
  check,
  options,
  onMap,
}: {
  check: TagCheck
  options: string[]
  onMap: (tag: string) => void
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/30">
      <td className="p-2 pl-3 align-top">
        <StatusPill check={check} />
      </td>
      <td className="p-2 align-top">
        <p className="font-mono text-foreground">{check.tag}</p>
        {check.mappedTo && (
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            → {check.mappedTo}
          </p>
        )}
        {check.status === 'error' && check.errorReason && (
          <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">
            {check.errorReason}
          </p>
        )}
        {check.status === 'missing' && check.isLabTag && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Lab measurement — supply via CSV or lab ingestion.
          </p>
        )}
        {/* Only a missing tag can be remapped. An errored row names a tag that
            IS present but unusable, so pointing the preset elsewhere would hide
            a data problem rather than fix it. */}
        {check.status === 'missing' && !check.isLabTag && (
          <Select value={check.mappedTo ?? ''} onValueChange={onMap}>
            <SelectTrigger className="mt-1 h-7 w-full max-w-56 text-[11px]">
              <SelectValue placeholder="Map to an existing tag…" />
            </SelectTrigger>
            <SelectContent>
              {options.map(tag => (
                <SelectItem key={tag} value={tag} className="font-mono text-xs">
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="p-2 align-top text-muted-foreground">
        {check.usedIn.join(', ')}
      </td>
      <td className="p-2 pr-3 align-top text-muted-foreground">
        {check.usedBy.includes('equation') ? 'Equation' : 'Raw tag'}
      </td>
    </tr>
  )
}

/** Colour AND label, never colour alone (DESIGN.md §6). */
function StatusPill({ check }: { check: TagCheck }) {
  const label =
    check.status === 'matched'
      ? 'Matched'
      : check.status === 'error'
        ? 'Unusable'
        : 'Missing'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        check.status === 'matched'
          ? 'bg-muted text-muted-foreground'
          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          check.status === 'matched' ? 'bg-muted-foreground/60' : 'bg-rose-500',
        )}
      />
      {label}
    </span>
  )
}
