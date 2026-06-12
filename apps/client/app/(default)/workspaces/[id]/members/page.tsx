'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'
import { WorkspaceMembers } from '../components/workspace-members'

export default function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { workspace, loading } = useWorkspace(id)

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-8">
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
                <Link href={`/workspaces/${id}/details`}>
                  {loading ? (
                    <Skeleton className="inline-block h-4 w-28" />
                  ) : (
                    (workspace?.name ?? 'Workspace')
                  )}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Members</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Users2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Members
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage team access and roles
              </p>
            </div>
          </div>
          <Link href={`/workspaces/${id}/details`}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Settings
            </Button>
          </Link>
        </div>

        <WorkspaceMembers workspaceId={id} />
      </div>
    </div>
  )
}
