'use client'

import { Sun, User, Building2, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Tab = 'theme' | 'account' | 'workspace' | 'plans'

interface SettingsSidebarProps {
  activeTab: Tab
  setActiveTab: (tab: Tab) => void
}

export function SettingsSidebar({
  activeTab,
  setActiveTab,
}: SettingsSidebarProps) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'theme', label: 'Appearance', icon: <Sun className="h-4 w-4" /> },
    { id: 'account', label: 'Account', icon: <User className="h-4 w-4" /> },
    {
      id: 'workspace',
      label: 'Workspace',
      icon: <Building2 className="h-4 w-4" />,
    },
    {
      id: 'plans',
      label: 'Plans & Billing',
      icon: <CreditCard className="h-4 w-4" />,
    },
  ]

  return (
    <div className="w-52 border-r border-border bg-card shrink-0">
      <div className="p-4 border-b border-border">
        <h1 className="text-base font-semibold text-foreground">Settings</h1>
      </div>
      <nav className="p-2 space-y-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
