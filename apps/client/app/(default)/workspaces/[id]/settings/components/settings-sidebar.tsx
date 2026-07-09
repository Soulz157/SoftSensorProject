'use client'

import { Info, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SettingsTab } from '../page'

interface SettingsSidebarProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
}: SettingsSidebarProps) {
  const tabs = [
    {
      id: 'info' as SettingsTab,
      label: 'General Info',
      icon: <Info className="h-4 w-4" />,
    },
    {
      id: 'members' as SettingsTab,
      label: 'Members/Team',
      icon: <Users className="h-4 w-4" />,
    },
  ]

  return (
    <div className="w-52 shrink-0 border-r border-border bg-card">
      <div className="border-b border-border p-4">
        <h1 className="text-base font-semibold text-foreground">Settings</h1>
      </div>
      <nav className="space-y-1 p-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
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
