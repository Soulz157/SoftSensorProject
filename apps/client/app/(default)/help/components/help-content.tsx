'use client'

import { useState } from 'react'
import { HelpNav, type HelpSection } from './help-nav'
import { SectionQuickStart } from './section-quick-start'
import { SectionWorkspaceSetup } from './section-workspace-setup'
import { SectionCanvasNodes } from './section-canvas-nodes'
import { SectionFaq } from './section-faq'
import { SectionTroubleshooting } from './section-troubleshooting'
import { SectionContact } from './section-contact'
import { SectionStatus } from './section-status'
import { cn } from '@/lib/utils'

const MOBILE_TABS: { id: HelpSection; label: string }[] = [
  { id: 'quick-start', label: 'Quick Start' },
  { id: 'workspace-setup', label: 'Workspace' },
  { id: 'canvas-nodes', label: 'Canvas' },
  { id: 'faq', label: 'FAQ' },
  { id: 'troubleshooting', label: 'Troubleshoot' },
  { id: 'contact', label: 'Contact' },
  { id: 'status', label: 'Status' },
]

function ActiveSection({ section }: { section: HelpSection }) {
  switch (section) {
    case 'quick-start':
      return <SectionQuickStart />
    case 'workspace-setup':
      return <SectionWorkspaceSetup />
    case 'canvas-nodes':
      return <SectionCanvasNodes />
    case 'faq':
      return <SectionFaq />
    case 'troubleshooting':
      return <SectionTroubleshooting />
    case 'contact':
      return <SectionContact />
    case 'status':
      return <SectionStatus />
  }
}

export function HelpContent() {
  const [active, setActive] = useState<HelpSection>('quick-start')

  return (
    <div className="flex flex-col lg:flex-row flex-1 min-h-0 h-full">
      {/* Left nav — desktop only */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-card overflow-y-auto p-4">
        <p className="px-3 mb-4 text-xs font-bold text-primary tracking-widest uppercase">
          Help & Support
        </p>
        <HelpNav active={active} onSelect={setActive} />
      </aside>

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* Mobile tab strip — hidden on desktop */}
        <div className="lg:hidden flex gap-1 overflow-x-auto px-4 py-2 border-b border-border bg-card shrink-0 no-scrollbar">
          {MOBILE_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
                active === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <ActiveSection section={active} />
        </main>
      </div>
    </div>
  )
}
