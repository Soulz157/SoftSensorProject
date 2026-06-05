'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Check, Cpu, Thermometer, Gauge, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasModel } from '@/services/canvas'
import { useCanvasContext } from '../../../../../../store/canvas'

interface NodePayload extends Record<string, unknown> {
  name: string
  type: 'machine' | 'sensor' | 'controller'
  status: 'normal' | 'warning' | 'alarm' | 'offline'
  icon?: string
  models: CanvasModel[]
}

const ACCENT_COLORS: Record<NodePayload['type'], string> = {
  machine: '#6366f1',
  sensor: '#f97316',
  controller: '#22c55e',
}

const STATUS_COLORS: Record<NodePayload['status'], string> = {
  normal: '#22c55e',
  warning: '#f97316',
  alarm: '#ef4444',
  offline: '#6b7280',
}

function NodeIcon({ type }: { type: NodePayload['type'] }) {
  switch (type) {
    case 'machine':
      return <Cpu size={16} />
    case 'sensor':
      return <Thermometer size={16} />
    case 'controller':
      return <Gauge size={16} />
  }
}

export function MachineNode({
  id,
  data,
  selected,
}: NodeProps<Node<NodePayload>>) {
  const {
    isBuildMode,
    nodeToDeleteId,
    onRequestDeleteNode,
    onConfirmDeleteNode,
    onCancelDeleteNode,
  } = useCanvasContext()
  const accent = ACCENT_COLORS[data.type]
  const statusColor = STATUS_COLORS[data.status]
  const isPendingDelete = nodeToDeleteId === id

  return (
    <div
      className={cn(
        'relative w-45 py-3.5 px-4 rounded-xl bg-card dark:bg-white/4',
        selected
          ? 'border border-[#3b82f6]'
          : 'border border-border dark:border-white/10',
      )}
      style={{
        boxShadow: selected
          ? '0 0 0 2px rgba(59,130,246,0.35), 0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)'
          : '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {/* Delete button — BUILD mode only */}
      {isBuildMode &&
        (isPendingDelete ? (
          <div className="absolute -top-3 -right-3 z-10 flex items-center gap-1">
            <button
              className="w-5 h-5 rounded-full bg-[#374151] border border-[#4b5563] text-white flex items-center justify-center hover:bg-[#4b5563] transition-colors cursor-pointer"
              onClick={e => {
                e.stopPropagation()
                onCancelDeleteNode()
              }}
            >
              <X size={9} />
            </button>
            <button
              className="w-5 h-5 rounded-full bg-red-500 border border-red-400 text-white flex items-center justify-center hover:bg-red-600 transition-colors cursor-pointer"
              onClick={e => {
                e.stopPropagation()
                onConfirmDeleteNode(id)
              }}
            >
              <Check size={9} />
            </button>
          </div>
        ) : (
          <button
            className="absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full bg-red-500 border border-red-400 text-white flex items-center justify-center hover:bg-red-600 transition-colors cursor-pointer"
            onClick={e => {
              e.stopPropagation()
              onRequestDeleteNode(id)
            }}
          >
            <X size={10} />
          </button>
        ))}

      {/* Left accent strip */}
      <div
        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-[2px]"
        style={{ background: accent }}
      />

      {/* React Flow Handles */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="react-flow__handle-custom w-2! h-2! bg-[#374151]! border-[1.5px]! border-[#4b5563]!"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="react-flow__handle-custom w-2! h-2! bg-[#374151]! border-[1.5px]! border-[#4b5563]!"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="react-flow__handle-custom w-2! h-2! bg-[#374151]! border-[1.5px]! border-[#4b5563]!"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="react-flow__handle-custom w-2! h-2! bg-[#374151]! border-[1.5px]! border-[#4b5563]!"
      />

      {/* Top row: icon + name */}
      <div className="flex items-center gap-2">
        {/* Icon box with status dot */}
        <div className="relative shrink-0">
          <div
            className="w-8.5 h-8.5 flex items-center justify-center rounded-lg"
            style={{
              background: `${accent}33`,
              border: `1px solid ${accent}66`,
              color: accent,
            }}
          >
            <NodeIcon type={data.type} />
          </div>
          {/* Status dot */}
          <div
            className="absolute -top-0.75 -right-0.75 w-2 h-2 rounded-full"
            style={{
              background: statusColor,
              border: '1.5px solid rgba(0,0,0,0.8)',
            }}
          />
        </div>

        {/* Name + model count */}
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-[13px] font-semibold leading-[1.3] truncate">
            {data.name}
          </p>
          <p className="text-muted-foreground text-[11px] leading-[1.3] mt-px">
            {data.models.length} model{data.models.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Model dots */}
      {data.models.length > 0 && (
        <div className="flex justify-end gap-1 mt-2.5">
          {data.models.map(model => (
            <div
              key={model.id}
              title={model.name}
              className={cn(
                'w-2 h-2 rounded-full',
                'bg-foreground/20 border border-foreground/15',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
