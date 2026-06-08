import { cn } from '@/lib/utils'

const MACHINE_TYPES = [
  { label: 'CNC Machine', icon: '⚙' },
  { label: 'Robot Arm', icon: '🦾' },
  { label: 'Sensor', icon: '📡' },
  { label: 'Conveyor', icon: '▬' },
  { label: 'Controller', icon: '🖥' },
]

const STATUS_KEYS = [
  { status: 'Alarm', dotClass: 'bg-red-500' },
  { status: 'Warning', dotClass: 'bg-amber-500' },
  { status: 'Normal', dotClass: 'bg-emerald-500' },
  { status: 'Offline', dotClass: 'bg-zinc-500' },
]

export function MachineLegend() {
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-[#0a0d14] px-4 py-2">
      {MACHINE_TYPES.map(({ label, icon }) => (
        <span
          key={label}
          className="flex items-center gap-1 text-[8px] text-muted-foreground/50"
        >
          <span>{icon}</span>
          {label}
        </span>
      ))}
      <div className="ml-auto flex items-center gap-3">
        {STATUS_KEYS.map(({ status, dotClass }) => (
          <span
            key={status}
            className="flex items-center gap-1 text-[8px] text-muted-foreground/50"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
            {status}
          </span>
        ))}
      </div>
    </footer>
  )
}
