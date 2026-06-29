'use client'
import { useState } from 'react'
import { Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  plantName: string
  onClose: () => void
  onAdd: (
    name: string,
    type: 'machine' | 'sensor' | 'controller',
  ) => Promise<void>
}

const EQUIPMENT_TYPES = [
  { value: 'machine', label: 'Machine' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'controller', label: 'Controller' },
] as const

export function AddEquipmentDialog({ open, plantName, onClose, onAdd }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'machine' | 'sensor' | 'controller'>(
    'machine',
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await onAdd(name.trim(), type)
      setName('')
      setType('machine')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setName('')
      setType('machine')
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            Add Equipment
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Adding to plant:{' '}
            <span className="font-medium text-foreground">{plantName}</span>
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Equipment Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. CNC Machine A1"
              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Equipment Type
            </label>
            <select
              value={type}
              onChange={e => setType(e.target.value as typeof type)}
              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {EQUIPMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading ? 'Adding…' : 'Add Equipment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
