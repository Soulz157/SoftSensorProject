'use client'
import { AlertCircle, Info, Terminal, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AIModel, ModelLog } from '@/types'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const LEVEL_MAP = {
  info: { icon: Info, cls: 'text-blue-400', bg: 'bg-blue-500/10' },
  warn: { icon: TriangleAlert, cls: 'text-amber-400', bg: 'bg-amber-500/10' },
  error: { icon: AlertCircle, cls: 'text-red-400', bg: 'bg-red-500/10' },
} as const

interface Props {
  model: AIModel | null
  open: boolean
  onClose: () => void
}

export function ModelLogSheet({ model, open, onClose }: Props) {
  const logs: ModelLog[] = model?.data?.logs ?? []

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            {model?.name} — Console
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex-1 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
          {logs.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No logs yet.
            </p>
          ) : (
            [...logs].reverse().map((log, i) => {
              const { icon: Icon, cls, bg } = LEVEL_MAP[log.level]
              return (
                <div
                  key={i}
                  className={cn(
                    'mb-1 flex items-start gap-2 rounded px-2 py-1',
                    bg,
                  )}
                >
                  <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', cls)} />
                  <span className="flex-1 break-all text-foreground">
                    {log.message}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
