'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  SettingsSidebar,
  Tab,
} from '@/app/(default)/settings/components/settings-sidebar'
import { AppearanceTab } from '@/app/(default)/settings/components/appearance'
import { AccountTab } from '@/app/(default)/settings/components/account'
import { WorkspaceTab } from '@/app/(default)/settings/components/workspace'
import PlansPage from './components/plans'

const VALID_TABS: Tab[] = ['theme', 'account', 'workspace', 'plans']

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab') as Tab | null
  const initialTab: Tab =
    rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'theme'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex-1 overflow-auto">
        {activeTab === 'plans' ? (
          <PlansPage />
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            {activeTab === 'theme' && <AppearanceTab />}
            {activeTab === 'account' && <AccountTab />}
            {activeTab === 'workspace' && <WorkspaceTab />}
          </div>
        )}
      </div>
    </div>
  )
}
