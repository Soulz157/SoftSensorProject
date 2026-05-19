'use client'

import { useState } from 'react'
import { AppLayout } from '@/components/app-layout'
import {
  SettingsSidebar,
  Tab,
} from '@/app/settings/components/settings-sidebar'
import { AppearanceTab } from '@/app/settings/components/appearance'
import { AccountTab } from '@/app/settings/components/account'
import { WorkspaceTab } from '@/app/settings/components/workspace'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('theme')

  return (
    <AppLayout>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Content panel */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            {activeTab === 'theme' && <AppearanceTab />}
            {activeTab === 'account' && <AccountTab />}
            {activeTab === 'workspace' && <WorkspaceTab />}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
