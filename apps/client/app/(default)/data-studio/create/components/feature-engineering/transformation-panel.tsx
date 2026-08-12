'use client'

import { useState, useMemo } from 'react'
import {
  Search,
  WandSparkles,
  Check,
  BarChart2,
  ArrowLeftRight,
  Shield,
  Info,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { type ScalerMethod } from '@/lib/preprocessing'

interface Props {
  numericColumns: string[]
  categoricalColumns: string[]
  scalerConfigs: Record<string, ScalerMethod>
  setScalerConfig: (column: string, method: ScalerMethod) => void
  trigger?: React.ReactNode
}

const SCALER_OPTIONS = [
  {
    value: 'standard',
    label: 'Standard Scaler (Z-Score)',
    description:
      'Transforms features to have a mean of 0 and std of 1. Best for normal distributions.',
    icon: BarChart2,
  },
  {
    value: 'minmax',
    label: 'Min-Max Scaler',
    description: 'Scales features to a 0 to 1 range. Preserves zero values.',
    icon: ArrowLeftRight,
  },
  {
    value: 'robust',
    label: 'Robust Scaler',
    description:
      'Uses median and IQR. Robust to datasets with extreme outliers.',
    icon: Shield,
  },
] as const

export function FeatureTransformDialog({
  numericColumns,
  categoricalColumns,
  setScalerConfig,
  trigger,
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [activeMethod, setActiveMethod] = useState<ScalerMethod>('standard')
  const [tab, setTab] = useState('scaling')

  const matchesSearch = (col: string) =>
    col.toLowerCase().includes(search.toLowerCase())

  const filteredNumeric = useMemo(
    () => numericColumns.filter(matchesSearch),
    [numericColumns, search],
  )
  const filteredCategorical = useMemo(
    () => categoricalColumns.filter(matchesSearch),
    [categoricalColumns, search],
  )
  const hasResults =
    filteredNumeric.length > 0 || filteredCategorical.length > 0

  const toggleTag = (tag: string) => {
    const next = new Set(selectedTags)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    setSelectedTags(next)
  }

  const handleApply = () => {
    selectedTags.forEach(tag => {
      setScalerConfig(tag, activeMethod)
    })
    setIsOpen(false)
    setSelectedTags(new Set())
  }

  const selectedMethodLabel = SCALER_OPTIONS.find(
    o => o.value === activeMethod,
  )?.label

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="cursor-pointer">
            <WandSparkles className="mr-2 h-3.5 w-3.5" />
            Feature Transformation
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] w-[97vw] max-w-[97vw] flex-col overflow-hidden p-0 sm:max-w-5xl sm:rounded-xl">
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <div className="flex items-center gap-2">
            <WandSparkles className="h-5 w-5 text-primary" />
            <DialogTitle className="text-lg">
              Feature Transformation
            </DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground">
            Scale numeric features or encode categorical data for model
            training.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex max-h-[40vh] shrink-0 flex-col border-b border-border/50 bg-background/50 md:max-h-none md:w-72 md:border-b-0 md:border-r">
            <div className="p-4">
              <div className="relative">
                {/* center vertically regardless of input height */}
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search features..."
                  className="bg-background pl-8 text-sm placeholder:text-muted-foreground"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pt-0">
              {!hasResults ? (
                <p className="text-center text-xs text-muted-foreground">
                  No features found.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Numeric group */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      Numeric
                      <span className="ml-1 font-normal normal-case">
                        ({filteredNumeric.length})
                      </span>
                    </p>
                    {filteredNumeric.map(col => (
                      <div
                        key={col}
                        className="flex items-center gap-2 rounded-md transition-colors hover:bg-muted/50"
                      >
                        <Checkbox
                          id={`tag-${col}`}
                          checked={selectedTags.has(col)}
                          onCheckedChange={() => toggleTag(col)}
                        />
                        <label
                          htmlFor={`tag-${col}`}
                          className="min-w-0 flex-1 cursor-pointer truncate font-mono text-sm font-medium leading-none"
                          title={col}
                        >
                          {col}
                        </label>
                      </div>
                    ))}
                  </div>

                  {/* Categorical group — shown only when categorical columns exist */}
                  {filteredCategorical.length > 0 && (
                    <div className="space-y-2 border-t border-border/50 pt-3">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        Categorical
                        <span className="ml-1 font-normal normal-case">
                          ({filteredCategorical.length})
                        </span>
                      </p>
                      {filteredCategorical.map(col => (
                        <div
                          key={col}
                          className="flex items-center gap-2 rounded-md transition-colors hover:bg-muted/50"
                        >
                          <Checkbox
                            id={`tag-${col}`}
                            checked={selectedTags.has(col)}
                            onCheckedChange={() => toggleTag(col)}
                          />
                          <label
                            htmlFor={`tag-${col}`}
                            className="min-w-0 flex-1 cursor-pointer truncate font-mono text-sm font-medium leading-none"
                            title={col}
                          >
                            {col}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-6 w-full">
            <Tabs
              value={tab}
              onValueChange={setTab}
              className="flex w-full flex-col"
            >
              {/* w-100 → w-full */}
              <TabsList className="mb-6 grid w-full grid-cols-2 bg-muted/40">
                <TabsTrigger value="scaling" className="cursor-pointer">
                  Scaling (Numeric)
                </TabsTrigger>
                <TabsTrigger value="encoding" className="cursor-pointer">
                  Encoding (Categorical)
                </TabsTrigger>
              </TabsList>

              <TabsContent value="scaling" className="space-y-4 outline-none">
                <h3 className="text-sm font-semibold text-foreground">
                  Select Scaling Method
                </h3>
                <RadioGroup
                  value={activeMethod}
                  onValueChange={value =>
                    setActiveMethod(value as ScalerMethod)
                  }
                  aria-label="Scaling method"
                  className="flex flex-col gap-3"
                >
                  {SCALER_OPTIONS.map(opt => {
                    const Icon = opt.icon
                    const isActive = activeMethod === opt.value
                    return (
                      <label
                        key={opt.value}
                        htmlFor={`scaler-${opt.value}`}
                        className={cn(
                          'relative flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors hover:bg-muted/50 motion-reduce:transition-none',
                          'has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-1 has-focus-visible:ring-offset-background',
                          isActive
                            ? 'border-primary bg-primary/10'
                            : 'border-border/50 bg-background/50',
                        )}
                      >
                        <RadioGroupItem
                          id={`scaler-${opt.value}`}
                          value={opt.value}
                          className="sr-only"
                        />
                        <div
                          className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                            isActive ? 'bg-primary/15' : 'bg-muted',
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-5 w-5',
                              isActive
                                ? 'text-primary'
                                : 'text-muted-foreground',
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium leading-none text-foreground">
                            {opt.label}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {opt.description}
                          </p>
                        </div>
                        {isActive && (
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </label>
                    )
                  })}
                </RadioGroup>
              </TabsContent>

              <TabsContent value="encoding" className="outline-none">
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/50 bg-muted/20 py-12 text-center">
                  <Info className="h-8 w-8 text-muted-foreground/50" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Not applicable</p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      Every sensor tag in the current dataset is numeric. There
                      are no categorical columns to encode.
                    </p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        {/* Footer */}
        <DialogFooter className="flex items-center justify-between border-t border-border/50 bg-background/30 px-6 py-4 sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div
              className={cn(
                'h-2 w-2 rounded-full',
                selectedTags.size > 0 ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            />
            <span>
              <span className="font-semibold text-foreground">
                {selectedTags.size}
              </span>{' '}
              tags selected for{' '}
              <span className="font-medium text-primary">
                {selectedMethodLabel}
              </span>
            </span>
          </div>
          <div className="flex gap-2 p-4">
            <Button
              variant="ghost"
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={selectedTags.size === 0}>
              Apply Pipeline
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
