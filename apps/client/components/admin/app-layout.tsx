'use client'

import { useState } from 'react'
import { useAtom } from 'jotai'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminNavbar } from '@/components/admin/navbar'
import { adminSidebarCollapsedAtom } from '@/store/admin'

interface AdminAppLayoutProps {
  children: React.ReactNode
}

export function AdminAppLayout({ children }: AdminAppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(
    adminSidebarCollapsedAtom,
  )

  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminNavbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
