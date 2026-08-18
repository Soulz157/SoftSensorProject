'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { SavedDataset } from '@/store/datasets'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

interface Props {
  dataset: SavedDataset | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DatasetConfigDialog({ dataset, open, onOpenChange }: Props) {
  const [copied, setCopied] = useState(false)
  const json = dataset ? JSON.stringify(dataset.pipelineConfig, null, 2) : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      toast.success('Config copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Failed to copy config')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="font-medium text-sm text-foreground">
            <Badge variant="secondary" className="mr-2 text-lg p-3">
              {dataset?.name}
            </Badge>
            · pipeline_config
          </DialogTitle>
          <DialogDescription>
            Read-only view of the saved preprocessing &amp; feature recipe.
          </DialogDescription>
        </DialogHeader>
        <div className="relative max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted/30">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!dataset}
            className="absolute right-3 top-3 z-10 h-7 gap-1.5 bg-background/80 px-2 text-xs backdrop-blur-sm hover:bg-background"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <pre className="w-max min-w-full p-4 font-mono text-xs leading-relaxed text-foreground">
            {json}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  )
}
