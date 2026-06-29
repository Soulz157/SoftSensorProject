import { AlertCircle, CheckCircle2, PauseCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeployVerdict } from '@/lib/model-status'

interface Props {
  verdict: DeployVerdict
}

const VERDICT_CONFIG = {
  failed: {
    icon: AlertCircle,
    bg: 'bg-red-500/10 border-red-500/30',
    icon_cls: 'text-red-500',
    text_cls: 'text-red-500',
    label: (count: number) =>
      `${count} model${count !== 1 ? 's' : ''} failed to deploy`,
    sub: 'Check deploy logs and restart affected models.',
  },
  initializing: {
    icon: RefreshCw,
    bg: 'bg-blue-500/10 border-blue-500/30',
    icon_cls: 'text-blue-400 animate-spin',
    text_cls: 'text-blue-400',
    label: (count: number) =>
      `${count} model${count !== 1 ? 's' : ''} initializing`,
    sub: 'Deployment in progress — page refreshes automatically.',
  },
  stopped: {
    icon: PauseCircle,
    bg: 'bg-zinc-500/10 border-zinc-500/30',
    icon_cls: 'text-zinc-400',
    text_cls: 'text-zinc-300',
    label: (count: number) =>
      `${count} model${count !== 1 ? 's' : ''} not deployed`,
    sub: 'Start models to begin inference.',
  },
  'all-running': {
    icon: CheckCircle2,
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    icon_cls: 'text-emerald-500',
    text_cls: 'text-emerald-400',
    label: (count: number) =>
      `All ${count} model${count !== 1 ? 's' : ''} running`,
    sub: 'All deployed models are active.',
  },
  empty: {
    icon: PauseCircle,
    bg: 'bg-zinc-500/10 border-zinc-500/30',
    icon_cls: 'text-zinc-400',
    text_cls: 'text-muted-foreground',
    label: () => 'No models found',
    sub: 'Create a model and assign it to a workspace.',
  },
} as const

export function DeployVerdictBanner({ verdict }: Props) {
  const cfg = VERDICT_CONFIG[verdict.kind]
  const Icon = cfg.icon
  const count = 'count' in verdict ? verdict.count : 0

  return (
    <div className={cn('flex items-start gap-4 rounded-xl border p-5', cfg.bg)}>
      <Icon className={cn('mt-0.5 h-6 w-6 shrink-0', cfg.icon_cls)} />
      <div>
        <p className={cn('text-base font-semibold', cfg.text_cls)}>
          {cfg.label(count)}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{cfg.sub}</p>
      </div>
    </div>
  )
}
