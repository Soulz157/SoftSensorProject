import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: string | number
  sub?: string
  accent?: 'emerald' | 'blue' | 'amber' | 'destructive'
  icon?: React.ElementType
}

export function StatCard({ label, value, sub, accent, icon: Icon }: Props) {
  const accentClasses = {
    emerald:
      'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 ring-emerald-500/20',
    blue: 'text-primary bg-primary/5 ring-primary/20',
    amber:
      'text-amber-600 dark:text-amber-400 bg-amber-500/5 ring-amber-500/20',
    destructive: 'text-destructive bg-destructive/5 ring-destructive/20',
  }

  const selectedAccent = accentClasses[accent ?? 'blue']
  const textColor = selectedAccent.split(' ')[0]

  return (
    <div
      className={cn(
        'flex items-start justify-between rounded-xl p-4 ring-1',
        selectedAccent,
      )}
    >
      <div>
        <p className="text-xs font-medium opacity-80">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] opacity-70">{sub}</p>}
      </div>
      {Icon && <Icon className={cn('h-8 w-8 opacity-20', textColor)} />}
    </div>
  )
}
