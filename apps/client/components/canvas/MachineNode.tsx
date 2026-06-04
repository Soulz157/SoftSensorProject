'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Cpu, Thermometer, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasModel } from '@/services/canvas'

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

const HANDLE_STYLE: React.CSSProperties = {
  width: 8,
  height: 8,
  background: '#374151',
  border: '1.5px solid #4b5563',
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

export function MachineNode({ data }: NodeProps<Node<NodePayload>>) {
  const accent = ACCENT_COLORS[data.type]
  const statusColor = STATUS_COLORS[data.status]

  return (
    <div
      style={{
        position: 'relative',
        width: 180,
        padding: '14px 16px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow:
          '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
        borderRadius: 12,
      }}
    >
      {/* Left accent strip */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 2,
          borderRadius: '0 2px 2px 0',
          background: accent,
        }}
      />

      {/* React Flow Handles */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="react-flow__handle-custom"
        style={HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="react-flow__handle-custom"
        style={HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="react-flow__handle-custom"
        style={HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="react-flow__handle-custom"
        style={HANDLE_STYLE}
      />

      {/* Top row: icon + name */}
      <div className={cn('flex items-center gap-2')}>
        {/* Icon box with status dot */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `${accent}33`,
              border: `1px solid ${accent}66`,
              borderRadius: 8,
              color: accent,
            }}
          >
            <NodeIcon type={data.type} />
          </div>
          {/* Status dot — top-right of icon box */}
          <div
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: statusColor,
              border: '1.5px solid rgba(0,0,0,0.8)',
            }}
          />
        </div>

        {/* Name + model count */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{
              color: '#e2e5f0',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {data.name}
          </p>
          <p
            style={{
              color: 'rgba(255,255,255,0.35)',
              fontSize: 11,
              lineHeight: 1.3,
              marginTop: 1,
            }}
          >
            {data.models.length} model{data.models.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Model dots — bottom-right footer */}
      {data.models.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 4,
            marginTop: 10,
          }}
        >
          {data.models.map(model => (
            <div
              key={model.id}
              title={model.name}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.25)',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
