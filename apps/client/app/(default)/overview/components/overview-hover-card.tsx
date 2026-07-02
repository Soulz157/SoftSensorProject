'use client'

import type { CSSProperties } from 'react'
import Image from 'next/image'
import { AlertTriangle, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { CanvasNode } from '@/services/canvas'
import type { AIModel, Workspace } from '@/types'
import type { NodeStatus } from '@/store/status-colors'
import { BINARY_STATUS_META, STATUS_META } from '@/lib/overview-status'
import { abnormalEquipment } from '@/lib/overview-tree'

const SECTION_ORDER: NodeStatus[] = ['alarm', 'warning', 'offline']
const MAX_PER_SECTION = 3

const STATUS_TOKENS: Record<NodeStatus, { dot: string; text: string }> = {
  alarm: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400' },
  offline: { dot: 'bg-zinc-400', text: 'text-zinc-500 dark:text-zinc-400' },
  normal: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
}

interface OverviewHoverCardProps {
  workspace: Workspace
  nodes: CanvasNode[]
  models: AIModel[]
  failedCount: number
  isDark: boolean
  width: number
  style: CSSProperties
}
export function OverviewHoverCard({
  workspace,
  nodes,
  models,
  failedCount,
  isDark,
  width,
  style,
}: OverviewHoverCardProps) {
  const abnormal = abnormalEquipment(nodes, models)
  const normalCount = nodes.length - abnormal.length
  const binary = abnormal.length > 0 ? 'abnormal' : 'normal'
  const binaryMeta = BINARY_STATUS_META[binary]

  const sections = SECTION_ORDER.map(status => ({
    status,
    items: abnormal.filter(n => n.status === status),
  })).filter(s => s.items.length > 0)

  return (
    <div
      className="pointer-events-none absolute z-20 shadow-xl backdrop-blur-md"
      style={{ width, ...style }}
    >
      <Card
        className={cn(
          'overflow-hidden border',
          isDark
            ? 'border-white/12 bg-black/80 text-white'
            : 'border-black/10 bg-white/95 text-foreground',
        )}
      >
        <CardContent className="p-0">
          {workspace.thumbnailUrl ? (
            <Image
              src={`${process.env.NEXT_PUBLIC_API_URL}${workspace.thumbnailUrl}`}
              alt={workspace.name}
              width={400}
              height={200}
              className="h-24 w-full object-cover"
              unoptimized={true}
            />
          ) : (
            <div
              className={cn(
                'flex h-16 w-full items-center justify-center',
                isDark ? 'bg-white/5' : 'bg-muted/40',
              )}
            >
              <Building2 className="h-5 w-5 text-muted-foreground/40" />
            </div>
          )}

          <div className="px-3 py-2.5">
            <p className="mb-2 truncate text-[11px] font-semibold leading-tight">
              {workspace.name}
            </p>

            {/* Binary status header */}
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  binaryMeta.dot,
                  binary === 'abnormal' &&
                    'ring-2 ring-red-500/30 motion-safe:animate-pulse',
                )}
              />
              <span
                className={cn(
                  'text-[11px] font-semibold tracking-wide',
                  binaryMeta.text,
                )}
              >
                {binaryMeta.label.toUpperCase()}{' '}
                <Badge
                  variant="secondary"
                  className="h-3.5 px-1 text-[8px] font-semibold ml-2 p-2"
                >
                  {binary === 'normal' ? normalCount : abnormal.length}
                </Badge>
              </span>
            </div>

            {failedCount > 0 && (
              <div className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle
                  className="h-3 w-3 shrink-0"
                  aria-hidden="true"
                />
                {failedCount} model deploy{failedCount > 1 ? 's' : ''} failed
              </div>
            )}

            {abnormal.length === 0 ? (
              <p
                className={cn(
                  'text-[10px]',
                  isDark ? 'text-white/40' : 'text-muted-foreground',
                )}
              >
                All equipment operating normally
              </p>
            ) : (
              <div className="space-y-1.5">
                {sections.map(section => {
                  const tok = STATUS_TOKENS[section.status]
                  const shown = section.items.slice(0, MAX_PER_SECTION)
                  const extra = section.items.length - shown.length
                  return (
                    <div key={section.status} className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn('text-[10px] font-semibold', tok.text)}
                        >
                          {STATUS_META[section.status].label}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] tabular-nums',
                            isDark
                              ? 'text-white/35'
                              : 'text-muted-foreground/60',
                          )}
                        >
                          ({section.items.length})
                        </span>
                      </div>

                      <div className="space-y-0.5 border-l border-border/40 pl-2">
                        {shown.map(eq => {
                          const eqModels = eq.models.filter(
                            m => m.deployFailed || m.status !== 'normal',
                          )
                          return (
                            <div key={eq.id}>
                              <div className="flex items-center gap-1.5 py-px">
                                <span
                                  className={cn(
                                    'h-1 w-1 shrink-0 rounded-full',
                                    tok.dot,
                                  )}
                                />
                                <span
                                  className={cn(
                                    'truncate text-[10px] font-medium',
                                    isDark
                                      ? 'text-white/70'
                                      : 'text-foreground',
                                  )}
                                  title={eq.name}
                                >
                                  {eq.name}
                                </span>
                              </div>

                              {eqModels.length > 0 && (
                                <div className="ml-3 space-y-px border-l border-border/30 pl-2">
                                  {eqModels.map(m => {
                                    const mtok = STATUS_TOKENS[m.status]
                                    return (
                                      <div
                                        key={m.id}
                                        className="flex items-center gap-1.5 py-px"
                                      >
                                        <span
                                          className={cn(
                                            'h-1 w-1 shrink-0 rounded-full opacity-70',
                                            mtok.dot,
                                          )}
                                        />
                                        <span
                                          className={cn(
                                            'truncate text-[10px]',
                                            isDark
                                              ? 'text-white/50'
                                              : 'text-muted-foreground',
                                          )}
                                          title={m.name}
                                        >
                                          {m.name}
                                        </span>
                                        {m.deployFailed && (
                                          <Badge
                                            variant="secondary"
                                            className="h-3.5 px-1 text-[8px] font-semibold text-amber-700 dark:text-amber-400"
                                          >
                                            failed
                                          </Badge>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {extra > 0 && (
                          <p
                            className={cn(
                              'py-px text-[10px]',
                              isDark
                                ? 'text-white/30'
                                : 'text-muted-foreground/50',
                            )}
                          >
                            +{extra} more
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <Separator className="my-2 opacity-20" />
            <p
              className={cn(
                'text-[10px]',
                isDark ? 'text-white/35' : 'text-muted-foreground',
              )}
            >
              {nodes.length} node{nodes.length === 1 ? '' : 's'} · double-click
              to open
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
