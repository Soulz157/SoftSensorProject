import { cn } from '@/lib/utils'

export type HelpSection =
  | 'quick-start'
  | 'workspace-setup'
  | 'canvas-nodes'
  | 'faq'
  | 'troubleshooting'
  | 'contact'
  | 'status'

interface NavGroup {
  label: string
  items: { id: HelpSection; label: string }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Getting Started',
    items: [
      { id: 'quick-start', label: 'Quick Start' },
      { id: 'workspace-setup', label: 'Workspace Setup' },
      { id: 'canvas-nodes', label: 'Canvas & Nodes' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { id: 'faq', label: 'FAQ' },
      { id: 'troubleshooting', label: 'Troubleshooting' },
    ],
  },
  {
    label: 'Support',
    items: [
      { id: 'contact', label: 'Contact Support' },
      { id: 'status', label: 'System Status' },
    ],
  },
]

interface HelpNavProps {
  active: HelpSection
  onSelect: (section: HelpSection) => void
}

export function HelpNav({ active, onSelect }: HelpNavProps) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map(group => (
        <div key={group.label}>
          <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(item => (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                  active === item.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}
