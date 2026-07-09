'use client'

import { useState } from 'react'
import { useAtom } from 'jotai'
import { Sidebar } from '@/components/layout/sidebar'
import { AdminNavbar } from '@/components/admin/navbar'
import { CreateWorkspaceDialog } from '@/components/create-workspace'
import { adminSidebarCollapsedAtom } from '@/store/admin'

interface AdminAppLayoutProps {
  children: React.ReactNode
}

export function AdminAppLayout({ children }: AdminAppLayoutProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(
    adminSidebarCollapsedAtom,
  )

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
        onCreateWorkspace={() => setCreateDialogOpen(true)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminNavbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <CreateWorkspaceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  )
}
