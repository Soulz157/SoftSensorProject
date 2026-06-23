'use client'

import {
  ArrowLeft,
  Cpu,
  FileArchive,
  Loader2,
  ServerCog,
  Tags,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { MOCK_PI_SERVERS } from '@/lib/mock-pi-servers'
import { useCreateModel } from '@/hooks/model/use-create-model'
import { ModelMetadataSection } from './model-metadata-section'
import { ArtifactUploadSection } from './artifact-upload-section'
import { PiServerSelect } from './pi-server-select'
import { TagListSection } from './tag-list-section'

export function CreateModelForm() {
  const {
    form,
    setName,
    setDescription,
    changeWorkspace,
    changePlant,
    setNodeId,
    plants,
    nodes,
    plantsLoading,
    artifact,
    selectArtifact,
    piServerId,
    setPiServerId,
    tags,
    toggleTag,
    isSubmitting,
    submit,
    cancel,
  } = useCreateModel()

  return (
    <div className="flex-1 overflow-auto bg-background p-6 pb-24 md:p-8 md:pb-24">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 gap-1.5 text-muted-foreground"
            onClick={cancel}
            disabled={isSubmitting}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to models
          </Button>
          <div className="flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">
              Create Model
            </h1>
          </div>
          <p className="pl-8 text-sm text-muted-foreground">
            Configure metadata, attach the packaged artifact, and map its tags.
          </p>
        </div>

        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Name, description, and where this model lives.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ModelMetadataSection
              name={form.name}
              description={form.description}
              workspaceId={form.workspaceId}
              plantId={form.plantId}
              nodeId={form.nodeId}
              plants={plants}
              nodes={nodes}
              plantsLoading={plantsLoading}
              disabled={isSubmitting}
              onName={setName}
              onDescription={setDescription}
              onWorkspace={changeWorkspace}
              onPlant={changePlant}
              onNode={setNodeId}
            />
          </CardContent>
        </Card>

        {/* Model artifact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileArchive className="h-4 w-4 text-muted-foreground" />
              Model File / Artifact
            </CardTitle>
            <CardDescription>
              Upload the packaged model (.pkg, .mar, or a zipped artifact).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArtifactUploadSection
              artifact={artifact}
              disabled={isSubmitting}
              onSelect={selectArtifact}
            />
          </CardContent>
        </Card>

        {/* Tag list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-4 w-4 text-muted-foreground" />
              Tag List
            </CardTitle>
            <CardDescription>
              Pick the PI server for this workspace, then choose which tags the
              model will use or predict.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!form.workspaceId ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Select a workspace above to list its PI servers.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <ServerCog className="h-3.5 w-3.5 text-muted-foreground" />
                    PI Server
                  </Label>
                  <PiServerSelect
                    servers={MOCK_PI_SERVERS}
                    value={piServerId}
                    onChange={setPiServerId}
                    disabled={isSubmitting}
                  />
                </div>

                {piServerId ? (
                  <TagListSection
                    tags={tags}
                    disabled={isSubmitting}
                    onToggle={toggleTag}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    Select a PI server to list its tags.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-6 py-3 md:px-8">
          <Button variant="outline" onClick={cancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isSubmitting} className="gap-1.5">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Creating…' : 'Create Model'}
          </Button>
        </div>
      </div>
    </div>
  )
}
