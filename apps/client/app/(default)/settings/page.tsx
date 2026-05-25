'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import {
  SettingsSidebar,
  Tab,
} from '@/app/(default)/settings/components/settings-sidebar'
import { AppearanceTab } from '@/app/(default)/settings/components/appearance'
import { AccountTab } from '@/app/(default)/settings/components/account'
import { WorkspaceTab } from '@/app/(default)/settings/components/workspace'
import PlansPage from './components/plans'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('theme')

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
          {activeTab === 'theme' && <AppearanceTab />}
          {activeTab === 'account' && <AccountTab />}
          {activeTab === 'workspace' && <WorkspaceTab />}
          {activeTab === 'plans' && <PlansPage />}
        </div>
      </div>
    </div>
  )
}
