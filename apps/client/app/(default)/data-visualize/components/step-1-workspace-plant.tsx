'use client'

import { Database } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useWorkspacePlants } from '@/hooks/workspace/use-workspace-plants'
import { workspaceIdAtom, plantIdAtom } from '@/store/data-visualize'
import { CascadeSelectors } from './cascade-selectors'
import type { useWizardNavigation } from '@/hooks/use-wizard-navigation'
import Link from 'next/link'

interface Props {
  nav: ReturnType<typeof useWizardNavigation>
}

export function Step1WorkspacePlant({ nav }: Props) {
  const { workspaces, loading } = useWorkspaces()
  const workspaceId = useAtomValue(workspaceIdAtom)
  const plantId = useAtomValue(plantIdAtom)
  const { plants, isFetching: plantsFetching } = useWorkspacePlants(
    workspaceId || null,
  )

  if (!loading && workspaces.length === 0) {
    return (
      <Alert>
        <Database />
        <AlertTitle>No workspaces yet</AlertTitle>
        <AlertDescription>
          Create a workspace to start visualizing data.
        </AlertDescription>
        <Button asChild size="sm" className="mt-2 w-fit">
          <Link href="/workspaces">Go to workspaces</Link>
        </Button>
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pick the workspace and plant to pull sensor tags from.
      </p>
      <CascadeSelectors
        workspaces={workspaces}
        workspaceId={workspaceId}
        onWorkspaceChange={nav.setWorkspaceId}
        plants={plants}
        plantId={plantId}
        onPlantChange={nav.setPlantId}
        plantsLoading={plantsFetching}
      />
    </div>
  )
}
