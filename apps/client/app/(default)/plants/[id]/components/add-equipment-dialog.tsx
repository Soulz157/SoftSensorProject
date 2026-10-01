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
import { STATUS_META, type NodeStatus } from '@/lib/overview-status'
import type { CanvasNode, EquipmentFormValues } from '@/services/canvas'

type EquipmentType = EquipmentFormValues['type']

interface Props {
  open: boolean
  plantName: string
  /** Present = edit this equipment; absent = add a new one. */
  node?: CanvasNode | null
  onClose: () => void
  onSubmit: (values: EquipmentFormValues) => Promise<void>
}

const EQUIPMENT_TYPES = [
  { value: 'machine', label: 'Machine' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'controller', label: 'Controller' },
] as const

const STATUS_ORDER: NodeStatus[] = ['normal', 'warning', 'alarm', 'offline']

/**
 * Add or edit one piece of equipment on the plant page. MODEL-SERVE-025-D02:
 * edit (name, type, status) moved here when the workspace canvas — the only
 * other place a node could be edited — was removed. Status reads through
 * `STATUS_META`, so a stored 'alarm' is offered as "Alert", the same word the
 * Alerts page uses. A new equipment always starts Normal.
 */
export function AddEquipmentDialog(props: Props) {
  const { open, onClose } = props
  return (
    <Dialog open={open} onOpenChange={isOpen => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted with `open` and keyed by the node, so each open starts
            from its own initial state — never a previous edit's leftovers. */}
        {open && <EquipmentForm key={props.node?.id ?? 'add'} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function EquipmentForm({ plantName, node, onClose, onSubmit }: Props) {
  const isEdit = Boolean(node)
  const [name, setName] = useState(node?.data.name ?? '')
  const [type, setType] = useState<EquipmentType>(
    (node?.data.type as EquipmentType | undefined) ?? 'machine',
  )
  const [status, setStatus] = useState<NodeStatus>(
    (node?.data.status as NodeStatus | undefined) ?? 'normal',
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await onSubmit({ name: name.trim(), type, status })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-primary" />
          {isEdit ? 'Edit Equipment' : 'Add Equipment'}
        </DialogTitle>
        <p className="text-sm text-muted-foreground">
          {isEdit ? 'In plant: ' : 'Adding to plant: '}
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
            onChange={e => setType(e.target.value as EquipmentType)}
            className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {EQUIPMENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Status
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as NodeStatus)}
              className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {STATUS_ORDER.map(s => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
        )}

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
            {loading
              ? isEdit
                ? 'Saving…'
                : 'Adding…'
              : isEdit
                ? 'Save Changes'
                : 'Add Equipment'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
