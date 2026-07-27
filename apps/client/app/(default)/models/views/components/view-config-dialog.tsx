'use client'

import { useState } from 'react'
import { Braces, Copy, Download } from 'lucide-react'
import { toast } from 'sonner'
import type { AIModel } from '@/types'
import { readModelConfig } from '@/lib/model-config'
import { useDatasetConfig } from '@/hooks/model/use-dataset-config'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Props {
  model: AIModel | null
  open: boolean
  onClose: () => void
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model'
  )
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function copyJson(data: unknown) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Failed to copy')
  }
}

/** Pretty-printed JSON block (or a muted empty/loading message). */
function JsonView({ data, empty }: { data: unknown; empty: string }) {
  if (data === null || data === undefined) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        {empty}
      </div>
    )
  }
  return (
    <div className="h-full w-full overflow-auto">
      <pre className="min-w-max p-6 font-mono text-xs leading-relaxed text-foreground">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

/**
 * Read-only viewer for a model's persisted configuration, shown from the models
 * list row menu. Two tabs: "Model" (`Model.data.config` via `readModelConfig`)
 * and "Pipeline" (the referenced dataset's `pipelineConfig` — the literal
 * pipeline_config.json, lazily fetched). Each tab offers Copy + Download .json.
 */
export function ViewConfigDialog({ model, open, onClose }: Props) {
  const [tab, setTab] = useState('model')

  const modelConfig = model ? readModelConfig(model) : null
  const datasetId = modelConfig?.datasetId || model?.datasetId || null
  const {
    pipelineConfig,
    loading: pipelineLoading,
    error: pipelineError,
  } = useDatasetConfig(datasetId, open)

  if (!model) return null

  const base = slugify(model.name)
  const activeIsModel = tab === 'model'
  const activeData = activeIsModel ? modelConfig : pipelineConfig
  const canExport = activeData !== null && activeData !== undefined

  const pipelineEmpty = !datasetId
    ? 'No linked dataset for this model.'
    : pipelineLoading
      ? 'Loading pipeline configuration…'
      : (pipelineError ?? 'No pipeline configuration found.')

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden  sm:max-w-2xl ">
        <DialogHeader className="border-b border-border p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Braces className="h-4 w-4 text-muted-foreground" />
            {model.name} — Configuration
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-6 pt-4">
            <TabsList>
              <TabsTrigger value="model" className="w-full cursor-pointer">
                Model
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="w-full cursor-pointer">
                Pipeline
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="model" className="flex min-h-0 flex-1 flex-col">
            <JsonView
              data={modelConfig}
              empty="This model has no saved configuration."
            />
          </TabsContent>

          <TabsContent
            value="pipeline"
            className="flex min-h-0 flex-1 flex-col"
          >
            <JsonView data={pipelineConfig} empty={pipelineEmpty} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t border-border p-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={!canExport}
            onClick={() => copyJson(activeData)}
            className="gap-2"
          >
            <Copy className="h-4 w-4" />
            Copy
          </Button>
          <Button
            disabled={!canExport}
            onClick={() =>
              downloadJson(
                `${base}-${activeIsModel ? 'model' : 'pipeline'}-config.json`,
                activeData,
              )
            }
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
