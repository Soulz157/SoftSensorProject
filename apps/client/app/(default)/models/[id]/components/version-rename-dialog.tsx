'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import type { ModelVersionRow } from '@/services/model-version'

const NAME_MAX = 100

interface Props {
  /** The STAGING version being renamed; null = closed. */
  target: ModelVersionRow | null
  busy: boolean
  onClose: () => void
  onSave: (name: string) => void
}

/**
 * Label for a STAGING version. Blank clears it back to the bare
 * `v{version}`. Keyed by the target's id at the call site so the field
 * re-seeds from the current name each time it opens.
 */
export function VersionRenameDialog({ target, busy, onClose, onSave }: Props) {
  const [name, setName] = useState(target?.name ?? '')

  return (
    <Dialog open={target !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault()
            if (!busy) onSave(name)
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename v{target?.version}</DialogTitle>
            <DialogDescription>
              A label shown beside the version number. Only staging versions can
              be renamed — leave it blank to clear the name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="version-name">Name</Label>
            <Input
              id="version-name"
              value={name}
              maxLength={NAME_MAX}
              placeholder="e.g. Winter data retrain"
              autoFocus
              disabled={busy}
              onChange={event => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
