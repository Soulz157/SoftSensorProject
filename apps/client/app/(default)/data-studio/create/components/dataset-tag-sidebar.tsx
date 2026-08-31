'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Tags,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Dataset } from '@/lib/preprocessing'
import { featureColumnName } from '@/lib/feature-engineering'
import {
  dwCsvUploadTagsAtom,
  dwFeaturedDatasetAtom,
  dwFeatureConfigsAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwTagSidebarCollapsedAtom,
  dwCurrentStepAtom,
  dwCleaningTagsAtom,
  dwCleanedTagsAtom,
  dwHighestUnlockedAtom,
  dwTargetTagAtom,
  dwRawDatasetAtom,
} from '@/store/dataset-studio'
import { useDatasetTagSelection } from '@/hooks/dataset/use-dataset-tag-selection'
import { BadDataBreakdown } from './bad-data-breakdown'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface TagGroup {
  id: string
  label: string
  tags: string[]
}

export function DatasetTagSidebar() {
  const featureConfigs = useAtomValue(dwFeatureConfigsAtom)
  const selectedTags = useAtomValue(dwSelectedTagsAtom)
  const csvTags = useAtomValue(dwCsvUploadTagsAtom)
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const fetched = useAtomValue(dwRawDatasetAtom)
  const featured = useAtomValue(dwFeaturedDatasetAtom)

  const dataset: Dataset = useMemo(() => {
    const base = fetched.tags.length > 0 ? fetched.tags : selectedTags
    const seen = new Set(base)
    const engineered = featured.tags.filter(t => !seen.has(t))
    return {
      tags: [...base, ...engineered],
      rows: featured.rows.length > 0 ? featured.rows : fetched.rows,
    }
  }, [fetched, featured, selectedTags])

  const hasData = dataset.rows.length > 0

  const {
    tags,
    activeTags,
    hidden,
    focusedTag,
    badByTag,
    badDetailByTag,
    colorForTag,
    toggleVisible,
    setFocused,
    selectAll,
    clearAll,
    refresh,
  } = useDatasetTagSelection(dataset)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useAtom(dwTagSidebarCollapsedAtom)
  const targetTag = useAtomValue(dwTargetTagAtom)
  const currentStep = useAtomValue(dwCurrentStepAtom)
  const [cleaningTags, setCleaningTags] = useAtom(dwCleaningTagsAtom)
  const cleanedTags = useAtomValue(dwCleanedTagsAtom)
  const setHighestUnlocked = useSetAtom(dwHighestUnlockedAtom)
  // DS-LAKE-022-T04..T07: Step 3's EDA/Cleaning sub-step switch died —
  // cleaning is now its own whole step (5), not a sub-step of 3.
  const isCleaning = currentStep === 5
  const cleaningSet = useMemo(() => new Set(cleaningTags), [cleaningTags])
  const cleanedSet = useMemo(() => new Set(cleanedTags), [cleanedTags])

  const relock = () => setHighestUnlocked(prev => Math.min(prev, 5))
  const toggleCleaning = (tag: string) => {
    setCleaningTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    )
    relock()
  }
  const cleanableTags = useMemo(
    () => tags.filter(t => t !== targetTag),
    [tags, targetTag],
  )
  const selectAllCleaning = () => {
    setCleaningTags(cleanableTags)
    relock()
  }
  const clearCleaning = () => {
    setCleaningTags([])
    relock()
  }

  const engineeredNames = useMemo(
    () => new Set(featureConfigs.map(featureColumnName)),
    [featureConfigs],
  )

  const groups = useMemo<TagGroup[]>(() => {
    const isTarget = (t: string) => targetTag !== null && t === targetTag

    const engineered = tags.filter(t => engineeredNames.has(t) && !isTarget(t))
    const base = tags.filter(t => !engineeredNames.has(t) && !isTarget(t))
    const csv = new Set(csvTags)
    const csvInDataset = base.filter(t => csv.has(t))
    const others = base.filter(t => !csv.has(t))

    const result: TagGroup[] = []

    if (targetTag) {
      result.push({
        id: 'target',
        label: 'Target Tag (Y)',
        tags: tags.filter(isTarget),
      })
    }

    if (csvInDataset.length > 0 && others.length > 0) {
      const sourceLabel =
        sources.length === 1 ? sources[0]!.name : 'Source Data'
      result.push({ id: 'source', label: sourceLabel, tags: others })
      result.push({ id: 'csv', label: 'CSV Data', tags: csvInDataset })
    } else {
      result.push({ id: 'all', label: 'Dataset Tags', tags: base })
    }
    if (engineered.length > 0) {
      result.push({
        id: 'engineered',
        label: 'Engineered Features',
        tags: engineered,
      })
    }
    return result
  }, [tags, csvTags, sources, engineeredNames, targetTag])

  const q = query.trim().toLowerCase()
  const matches = (tag: string) => tag.toLowerCase().includes(q)

  useEffect(() => {
    refresh()
  }, [refresh])

  // ── Collapsed: narrow strip with an expand button ──
  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-3 border-r border-sidebar-border bg-sidebar py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="cursor-pointer"
          onClick={() => setCollapsed(false)}
          aria-label="Expand tag sidebar"
          title="Expand tag sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <Tags className="h-4 w-4" />
          <span className="text-[10px] font-medium">{tags.length}</span>
        </div>
      </aside>
    )
  }

  return (
    <TooltipProvider delayDuration={100}>
      <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:w-80">
        {/* Header */}
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <Tags className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-sidebar-foreground">
            Dataset Tags
          </h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {activeTags.length} / {tags.length}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse tag sidebar"
            title="Collapse tag sidebar"
            className="cursor-pointer"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        {/* Search + global actions */}
        <div className="space-y-3 border-b border-sidebar-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search tags..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              className="cursor-pointer h-7 px-2 text-xs"
              onClick={isCleaning ? selectAllCleaning : selectAll}
              disabled={tags.length === 0}
            >
              Select All
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="cursor-pointer h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={isCleaning ? clearCleaning : clearAll}
              disabled={tags.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        {/* Tag list */}
        <div className="relative min-h-0 flex-1">
          <ScrollArea className="h-full w-full">
            {tags.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                Select tags in Step 1 to populate this list.
              </p>
            ) : (
              <Accordion
                key={`${groups.map(g => g.id).join('|')}-${tags.length}`}
                type="multiple"
                defaultValue={groups.map(g => g.id)}
                className="px-1 py-2"
              >
                {groups.map(group => {
                  const groupTags = group.tags.filter(matches)
                  return (
                    <AccordionItem
                      key={group.id}
                      value={group.id}
                      className="border-none"
                    >
                      <AccordionTrigger className="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:no-underline">
                        {group.label}
                        <Badge className="ml-2 h-4 items-center bg-muted font-medium text-muted-foreground">
                          {group.id === 'target' ? 'Y' : group.tags.length}
                        </Badge>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2">
                        {groupTags.length === 0 ? (
                          group.id === 'target' && group.tags.length === 0 ? (
                            <p className="mx-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                              <span className="font-mono font-medium">
                                {targetTag}
                              </span>
                            </p>
                          ) : (
                            <p className="px-4 py-1.5 text-xs text-muted-foreground">
                              No matches
                            </p>
                          )
                        ) : (
                          <ul className="pr-1">
                            {groupTags.map(tag => {
                              const isHidden = hidden.has(tag)
                              const isFocused = tag === focusedTag[0]
                              const badCount = badByTag[tag] ?? 0
                              const isTargetRow = tag === targetTag

                              return (
                                <li key={tag}>
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      setFocused([tag])
                                      if (isCleaning && !isTargetRow) {
                                        toggleCleaning(tag)
                                      }
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        setFocused([tag])
                                      }
                                    }}
                                    className={cn(
                                      'flex cursor-pointer items-center gap-2 border-l-2 px-1 py-2 transition-colors',
                                      isFocused
                                        ? 'border-primary bg-primary/10'
                                        : 'border-transparent hover:bg-sidebar-accent',
                                      isHidden && !isFocused && 'opacity-60',
                                    )}
                                  >
                                    <Checkbox
                                      checked={
                                        isCleaning
                                          ? cleaningSet.has(tag)
                                          : !isHidden
                                      }
                                      onClick={e => e.stopPropagation()}
                                      onCheckedChange={() =>
                                        isCleaning
                                          ? toggleCleaning(tag)
                                          : toggleVisible(tag)
                                      }
                                      aria-label={
                                        isCleaning
                                          ? `Toggle ${tag} cleaning`
                                          : `Toggle ${tag} visibility`
                                      }
                                      className="shrink-0"
                                    />
                                    <span
                                      className={cn(
                                        'h-2.5 w-2.5 shrink-0 rounded-full transition-opacity',
                                        isHidden && 'opacity-30',
                                      )}
                                      style={{
                                        backgroundColor: colorForTag(tag),
                                      }}
                                    />
                                    <Tooltip>
                                      <TooltipContent>
                                        <p>{tag}</p>
                                      </TooltipContent>
                                      <TooltipTrigger>
                                        <span
                                          className={cn(
                                            'truncate font-mono text-xs',
                                            isFocused
                                              ? 'font-medium text-foreground'
                                              : isHidden
                                                ? 'text-muted-foreground/70'
                                                : 'text-sidebar-foreground',
                                          )}
                                          title={tag}
                                        >
                                          {tag}
                                        </span>
                                      </TooltipTrigger>
                                    </Tooltip>
                                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                      {isCleaning && cleanedSet.has(tag) ? (
                                        <span
                                          className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                                          title={`${tag} cleaned`}
                                        >
                                          <CheckCircle2 className="h-3 w-3" />
                                          Cleaned
                                        </span>
                                      ) : (
                                        isCleaning &&
                                        cleaningSet.has(tag) && (
                                          <span
                                            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                            title={`${tag} pending — not yet saved`}
                                          >
                                            Pending
                                          </span>
                                        )
                                      )}
                                      {badCount > 0 && (
                                        <Popover>
                                          <PopoverTrigger asChild>
                                            <button
                                              type="button"
                                              onClick={e => e.stopPropagation()}
                                              aria-label={`Bad data detail for ${tag}`}
                                              className="flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/20 dark:text-purple-400"
                                              title={`${badCount} Bad/Questionable/Frozen rows`}
                                            >
                                              {badCount}
                                              <Info className="h-3 w-3 opacity-70" />
                                            </button>
                                          </PopoverTrigger>
                                          <PopoverContent
                                            align="end"
                                            className="w-64 p-3"
                                            onClick={e => e.stopPropagation()}
                                          >
                                            <BadDataBreakdown
                                              tag={tag}
                                              badCount={badCount}
                                              detail={badDetailByTag[tag]}
                                            />
                                          </PopoverContent>
                                        </Popover>
                                      )}
                                      <button
                                        type="button"
                                        onClick={e => {
                                          e.stopPropagation()
                                          toggleVisible(tag)
                                        }}
                                        aria-label={
                                          isHidden
                                            ? `Show ${tag}`
                                            : `Hide ${tag}`
                                        }
                                        className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                                      >
                                        {isHidden ? (
                                          <EyeOff className="h-3.5 w-3.5" />
                                        ) : (
                                          <Eye className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            )}
          </ScrollArea>
        </div>

        {!hasData && tags.length > 0 && (
          <div className="border-t border-sidebar-border px-4 py-2.5 text-[11px] text-muted-foreground">
            Fetch data to enable analysis &amp; quality checks.
          </div>
        )}
      </aside>
    </TooltipProvider>
  )
}
