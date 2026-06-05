import { cn } from '@/lib/utils'

interface Service {
  name: string
  status: 'operational' | 'degraded' | 'outage'
}

const SERVICES: Service[] = [
  { name: 'API Server', status: 'operational' },
  { name: 'Canvas Engine', status: 'operational' },
  { name: 'Alert Service', status: 'operational' },
]

const STATUS_STYLES: Record<
  Service['status'],
  { dot: string; badge: string; label: string }
> = {
  operational: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    label: 'Operational',
  },
  degraded: {
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    label: 'Degraded',
  },
  outage: {
    dot: 'bg-red-500',
    badge: 'bg-red-500/10 text-red-600 dark:text-red-400',
    label: 'Outage',
  },
}

export function SectionStatus() {
  const allOperational = SERVICES.every(s => s.status === 'operational')

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">System Status</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Current operational status of SoftSensor services.
      </p>

      {/* Overall status banner */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3 mb-4',
          allOperational
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : 'bg-amber-500/5 border-amber-500/20',
        )}
      >
        <span
          className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0',
            allOperational ? 'bg-emerald-500' : 'bg-amber-500',
          )}
        />
        <p className="text-sm font-medium text-foreground">
          {allOperational ? 'All systems operational' : 'Some systems degraded'}
        </p>
      </div>

      {/* Service rows */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {SERVICES.map((service, i) => {
          const styles = STATUS_STYLES[service.status]
          return (
            <div
              key={service.name}
              className={cn(
                'flex items-center justify-between px-4 py-3',
                i < SERVICES.length - 1 && 'border-b border-border',
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn('w-2 h-2 rounded-full shrink-0', styles.dot)}
                />
                <span className="text-sm text-foreground">{service.name}</span>
              </div>
              <span
                className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  styles.badge,
                )}
              >
                {styles.label}
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Last checked: just now
      </p>
    </div>
  )
}
