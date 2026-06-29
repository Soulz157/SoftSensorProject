'use client'

import { useState, useEffect } from 'react'
import { useAtom } from 'jotai'
import { useRouter, usePathname } from 'next/navigation'
import { Navbar } from '@/components/layout/navbar'
import { Sidebar } from '@/components/layout/sidebar'
import { sidebarCollapsedAtom } from '@/store/workspace'
import { CreateWorkspaceDialog } from '../create-workspace'

interface AppLayoutProps {
  children?: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)

  useEffect(() => {
    if (sessionStorage.getItem('came-from-404')) {
      sessionStorage.removeItem('came-from-404')
      router.refresh()
    }
  }, [pathname, router])

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Navbar
          onMenuClick={() => setSidebarOpen(true)}
          onCreateWorkspace={() => setCreateDialogOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <CreateWorkspaceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </div>
  )
}
