'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { SavedDataset } from '@/store/datasets'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  dataset: SavedDataset | null
  onSave: (name: string, description: string) => void
}

/** Rename / edit-description dialog for a saved dataset (workspace + sources are immutable). */
export function EditDatasetDialog({
  open,
  onOpenChange,
  dataset,
  onSave,
}: Props) {
  const [name, setName] = useState(dataset?.name ?? '')
  const [description, setDescription] = useState(dataset?.description ?? '')

  // Re-seed when a different dataset is handed in — adjusted during render
  // (React's "storing information from previous renders" pattern), not in an
  // effect that would paint one frame of the previous dataset's values.
  const [seededFrom, setSeededFrom] = useState(dataset)
  if (seededFrom !== dataset) {
    setSeededFrom(dataset)
    if (dataset) {
      setName(dataset.name)
      setDescription(dataset.description ?? '')
    }
  }

  const handleSave = () => {
    if (!name.trim()) return
    onSave(name.trim(), description.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Edit dataset
          </DialogTitle>
          <DialogDescription>
            Update the name or description of this dataset.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-ds-name" className="text-xs font-medium">
              Dataset name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-ds-name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-ds-desc" className="text-xs font-medium">
              Description{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="edit-ds-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="min-h-18 resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={handleSave}
            className="gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
