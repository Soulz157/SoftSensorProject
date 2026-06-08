'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Layers, Plus } from 'lucide-react'
import { CreateWorkspaceDialog } from '@/components/create-workspace'

export function DashboardHeader() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="mt-1 text-muted-foreground">
            Overview of all workspaces, nodes, and AI models
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/workspaces">
            <Button variant="outline" className="gap-2">
              <Layers className="h-4 w-4" />
              View Workspaces
            </Button>
          </Link>
          <Button
            className="gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
            onClick={() => setIsOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Create Workspace
          </Button>
        </div>
      </div>

      <CreateWorkspaceDialog open={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  )
}
