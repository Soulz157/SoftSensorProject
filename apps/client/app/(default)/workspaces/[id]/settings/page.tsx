'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Skeleton } from '@/components/ui/skeleton'

import { SettingsSidebar } from './components/settings-sidebar'
import { WorkspaceInfo } from './components/workspace-info'
import { WorkspaceMembers } from './components/workspace-member'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'

export type SettingsTab = 'info' | 'members'

export default function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [activeTab, setActiveTab] = useState<SettingsTab>('info')
  const { workspace, loading: wsLoading } = useWorkspace(id)

  if (wsLoading) {
    return (
      <div className="flex-1 overflow-auto bg-background p-6 md:p-8 min-h-0 w-full">
        <div className="mx-auto max-w-8xl space-y-8">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="flex-1 overflow-auto bg-background p-6 md:p-8 min-h-0 w-full">
        <div className="mx-auto max-w-8xl space-y-8">
          <p className="text-sm text-muted-foreground">
            Workspace not found or you do not have access.
          </p>
          <Link href="/workspaces">
            <button
              className=" 
px-4 py-2 rounded-md bg-primary text-white hover:bg-primary/90"
            >
              Back to Workspaces
            </button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8 min-h-0 w-full">
      <div className="mx-auto max-w-8xl space-y-8">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/workspaces">Workspaces</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/workspaces/${id}`}>
                  {wsLoading ? (
                    <Skeleton className="inline-block h-4 w-24" />
                  ) : (
                    (workspace?.name ?? 'Workspace')
                  )}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Workspace Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your workspace details and team members.
          </p>
        </div>

        {/* Layout: Sidebar + Content */}
        <div className="flex flex-col gap-8 md:flex-row ">
          {/* Sidebar Component */}
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="flex-1">
            {activeTab === 'info' && (
              <WorkspaceInfo workspace={workspace} loading={wsLoading} />
            )}
            {activeTab === 'members' && <WorkspaceMembers workspaceId={id} />}
          </div>
        </div>
      </div>
    </div>
  )
}
