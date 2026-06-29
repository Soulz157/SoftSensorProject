import { Layers, Palette, Circle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Tip {
  icon: LucideIcon
  title: string
  body: string
}

const TIPS: Tip[] = [
  {
    icon: Layers,
    title: 'Naming Conventions',
    body: 'Use descriptive names like "Boiler Room A" or "Compressor Line 3". Names appear in the sidebar, canvas, and alert notifications.',
  },
  {
    icon: Palette,
    title: 'Icon & Color Tags',
    body: 'Assign an icon and accent color when creating a workspace. These appear as visual identifiers throughout the app, making workspaces easy to distinguish at a glance.',
  },
  {
    icon: Circle,
    title: 'Status Dots',
    body: 'The colored dot next to a workspace name reflects its highest-severity node status: green (Normal), amber (Warning), red (Alarm), gray (Offline).',
  },
]

export function SectionWorkspaceSetup() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">
        Workspace Setup
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Organize your monitoring environment with well-structured workspaces.
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
