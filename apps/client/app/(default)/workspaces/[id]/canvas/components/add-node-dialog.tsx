'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { WorkspacePlant } from '@/types'

type NodeType = 'machine' | 'sensor' | 'controller'
type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

interface AddNodeDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (
    name: string,
    type: NodeType,
    status: NodeStatus,
    plantId: string,
  ) => void
  plants: WorkspacePlant[]
  activePlantId: string | null
}

const TYPE_OPTIONS: { value: NodeType; label: string; color: string }[] = [
  { value: 'machine', label: 'Machine', color: '#6366f1' },
  { value: 'sensor', label: 'Sensor', color: '#f97316' },
  { value: 'controller', label: 'Controller', color: '#22c55e' },
]

const STATUS_OPTIONS: { value: NodeStatus; label: string; color: string }[] = [
  { value: 'normal', label: 'Normal', color: '#22c55e' },
  { value: 'warning', label: 'Warning', color: '#f97316' },
  { value: 'alarm', label: 'Alarm', color: '#ef4444' },
  { value: 'offline', label: 'Offline', color: '#6b7280' },
]

export function AddNodeDialog({
  open,
  onClose,
  onAdd,
  plants,
  activePlantId,
}: AddNodeDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<NodeType>('machine')
  const [status, setStatus] = useState<NodeStatus>('normal')
  const [plantId, setPlantId] = useState<string>(
    activePlantId ?? plants[0]?.id ?? '',
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  function reset() {
    setName('')
    setType('machine')
    setStatus('normal')
    setPlantId(activePlantId ?? plants[0]?.id ?? '')
    setIsSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!name.trim() || !plantId || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onAdd(name.trim(), type, status, plantId)
      reset()
    } catch {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={open => !open && handleClose()}>
      <DialogContent
        style={{ background: '#111320', border: '1px solid #1e2235' }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: '#e2e5f0' }}>
            Add Machine Node
          </DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Plant */}
          {plants.length > 0 && (
            <div>
              <label
                style={{
                  display: 'block',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Plan
              </label>
              <select
                value={plantId}
                onChange={e => setPlantId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: '#0a0c12',
                  border: '1px solid #2d3147',
                  color: '#e2e5f0',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                {plants.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Name */}
          <div>
            <label
              style={{
                display: 'block',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Name
            </label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. CNC Machine A1"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{
                background: '#0a0c12',
                border: '1px solid #2d3147',
                color: '#e2e5f0',
              }}
            />
          </div>

          {/* Type */}
          <div>
            <label
              style={{
                display: 'block',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Type
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setType(opt.value)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    cursor: 'pointer',
                    border:
                      type === opt.value
                        ? `1px solid ${opt.color}`
                        : '1px solid #2d3147',
                    background:
                      type === opt.value ? `${opt.color}22` : 'transparent',
                    color: type === opt.value ? opt.color : '#4b5563',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <label
              style={{
                display: 'block',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Status
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 8,
                    cursor: 'pointer',
                    border:
                      status === opt.value
                        ? `1px solid ${opt.color}`
                        : '1px solid #2d3147',
                    background:
                      status === opt.value ? `${opt.color}22` : 'transparent',
                    color: status === opt.value ? opt.color : '#4b5563',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleClose}
            style={{ color: '#4b5563' }}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !plantId || isSubmitting}
            style={{
              background: '#6366f1',
              color: '#fff',
              opacity: !name.trim() || !plantId || isSubmitting ? 0.5 : 1,
            }}
            className="cursor-pointer"
          >
            {isSubmitting ? 'Adding...' : 'Add Node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
