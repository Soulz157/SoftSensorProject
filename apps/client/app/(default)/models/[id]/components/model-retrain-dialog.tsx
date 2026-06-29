'use client'

import { useState } from 'react'
import { Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DEFAULT_RETRAIN_CONFIG, type RetrainConfig } from '@/lib/retrain'
import type { AIModel } from '@/types'
import { CustomFinetuneForm } from './custom-finetune-form'

export function ModelRetrainDialog({
  open,
  onClose,
  model,
  isRetraining,
  mode,
  onAuto,
  onCustom,
}: {
  open: boolean
  onClose: () => void
  model: AIModel
  isRetraining: boolean
  mode: 'auto' | 'custom' | null
  onAuto: () => void
  onCustom: (config: RetrainConfig) => void
}) {
  const [config, setConfig] = useState<RetrainConfig>(DEFAULT_RETRAIN_CONFIG)

  return (
    <Dialog open={open} onOpenChange={o => !o && !isRetraining && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Retrain {model.name}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="auto" className="flex w-full flex-col">
          <TabsList className="flex h-10 w-full flex-row items-center rounded-md bg-muted p-1">
            <TabsTrigger value="auto" className="flex-1">
              Auto Finetune
            </TabsTrigger>
            <TabsTrigger value="custom" className="flex-1">
              Custom Finetune
            </TabsTrigger>
          </TabsList>

          <TabsContent value="auto" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Automatically selects the best regression model and
              hyperparameters via cross-validation. No configuration needed.
            </p>
            <Button
              className="w-full gap-2"
              onClick={onAuto}
              disabled={isRetraining}
            >
              <Sparkles className="h-4 w-4" />
              {isRetraining && mode === 'auto'
                ? 'Retraining…'
                : 'Start Auto Finetune'}
            </Button>
          </TabsContent>

          <TabsContent value="custom" className="space-y-4 pt-4">
            <CustomFinetuneForm
              config={config}
              onChange={setConfig}
              disabled={isRetraining}
            />
            <Button
              className="w-full gap-2"
              onClick={() => onCustom(config)}
              disabled={isRetraining}
            >
              <Wand2 className="h-4 w-4" />
              {isRetraining && mode === 'custom'
                ? 'Retraining…'
                : 'Start Custom Finetune'}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
