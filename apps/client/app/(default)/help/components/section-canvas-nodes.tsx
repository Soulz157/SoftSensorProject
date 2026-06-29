import { Eye, MousePointer, Cpu, CheckSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Tip {
  icon: LucideIcon
  title: string
  body: string
}

const TIPS: Tip[] = [
  {
    icon: Eye,
    title: 'Build Mode vs View Mode',
    body: 'Toggle between modes using the VIEW / BUILD switch in the canvas toolbar. View Mode is read-only. Build Mode lets you add nodes, draw connections, and drag nodes into position.',
  },
  {
    icon: MousePointer,
    title: 'Connecting Nodes',
    body: 'In Build Mode, drag from any handle (the dots on node edges) to another node to create an edge. Edges represent physical or logical connections between devices.',
  },
  {
    icon: Cpu,
    title: 'Node Types',
    body: 'Machine (purple) represents production equipment. Sensor (orange) represents data collection points. Controller (green) represents automation or control systems.',
  },
  {
    icon: CheckSquare,
    title: 'Confirm or Cancel Edits',
    body: 'After making changes in Build Mode, click ✓ Confirm to persist them or Cancel to revert. Changes are not saved until you confirm.',
  },
]

export function SectionCanvasNodes() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Canvas & Nodes</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Build your plant topology visually using the canvas editor.
      </p>
      <div className="flex flex-col gap-3">
        {TIPS.map(tip => {
          const Icon = tip.icon
          return (
            <div
              key={tip.title}
              className="flex gap-4 items-start bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
                <Icon size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-0.5">
                  {tip.title}
                </p>
                <p className="text-sm text-muted-foreground">{tip.body}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
