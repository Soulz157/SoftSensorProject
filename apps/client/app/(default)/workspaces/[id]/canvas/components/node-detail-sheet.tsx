'use client'

import { X, CheckCircle2, Minus } from 'lucide-react'
import { Cpu, Thermometer, Gauge } from 'lucide-react'
import type { CanvasData } from '@/hooks/canvas/use-canvas'

type CanvasRFNode = CanvasData['nodes'][number]

const ACCENT_COLORS: Record<string, string> = {
  machine: '#6366f1',
  sensor: '#f97316',
  controller: '#22c55e',
}

const STATUS_COLORS: Record<string, string> = {
  normal: '#22c55e',
  warning: '#f97316',
  alarm: '#ef4444',
  offline: '#6b7280',
}

const STATUS_LABELS: Record<string, string> = {
  normal: 'Normal',
  warning: 'Warning',
  alarm: 'Alarm',
  offline: 'Offline',
}

const SECTION_CLASS =
  'text-[rgba(255,255,255,0.4)] text-[10px] font-bold tracking-[0.1em] uppercase mb-2.5'

function NodeIcon({
  type,
  size = 16,
  color,
}: {
  type: string
  size?: number
  color?: string
}) {
  const props = { size, color: color ?? '#e2e5f0' }
  switch (type) {
    case 'sensor':
      return <Thermometer {...props} />
    case 'controller':
      return <Gauge {...props} />
    default:
      return <Cpu {...props} />
  }
}

const ACTIVITY_BARS = [40, 60, 35, 80, 55, 70, 45, 90, 50, 65, 75, 85]

interface Props {
  node: CanvasRFNode
  onClose: () => void
}

export function NodeDetailPanel({ node, onClose }: Props) {
  const { data } = node
  const accent = ACCENT_COLORS[data.type] ?? '#6366f1'
  const statusColor = STATUS_COLORS[data.status] ?? '#6b7280'

  return (
    <div className="w-80 shrink-0 bg-[#111320] border-l border-[#1e2235] flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[#1e2235] flex items-start gap-3">
        <div
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-[10px]"
          style={{
            background: `${accent}22`,
            border: `1px solid ${accent}44`,
            color: accent,
          }}
        >
          <NodeIcon type={data.type} size={18} color={accent} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[#e2e5f0] text-sm font-bold truncate m-0">
            {data.name}
          </p>
          <p className="text-[#4b5563] text-[11px] mt-0.5 capitalize">
            {data.type} Node
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-md border border-[#2d3147] bg-transparent text-[#6b7280] cursor-pointer shrink-0 hover:text-[#9ca3af] hover:border-[#4b5563] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-5 flex-1">
        {/* STATUS */}
        <div>
          <p className={SECTION_CLASS}>Status</p>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: statusColor }}
            />
            <span className="text-[#e2e5f0] text-[13px] capitalize">
              {STATUS_LABELS[data.status] ?? data.status}
            </span>
          </div>
        </div>

        {/* AI MODELS */}
        <div>
          <p className={SECTION_CLASS}>AI Models ({data.models.length})</p>
          {data.models.length === 0 ? (
            <p className="text-[#4b5563] text-xs">No models attached.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.models.map(model => {
                const accuracy =
                  typeof model.data?.accuracy === 'string'
                    ? model.data.accuracy
                    : undefined
                return (
                  <div
                    key={model.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 bg-white/3 border border-white/[0.07] rounded-lg"
                  >
                    <div
                      className="w-7 h-7 flex items-center justify-center rounded-md shrink-0"
                      style={{
                        background: `${accent}18`,
                        border: `1px solid ${accent}33`,
                        color: accent,
                      }}
                    >
                      <NodeIcon type={data.type} size={13} color={accent} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#c7cad4] text-xs font-semibold truncate m-0">
                        {model.name}
                      </p>
                      <p className="text-[#4b5563] text-[10px] mt-px">
                        Accuracy: {accuracy ?? '—'}
                      </p>
                    </div>
                    {accuracy != null ? (
                      <CheckCircle2 size={14} color="#22c55e" />
                    ) : (
                      <Minus size={14} color="#4b5563" />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* QUICK STATS */}
        <div>
          <p className={SECTION_CLASS}>Quick Stats</p>
          <div className="flex flex-col gap-1.5">
            {(
              [
                { label: 'Uptime', value: '—' },
                { label: 'Last Update', value: '—' },
                { label: 'Data Points', value: '—' },
              ] as const
            ).map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-center py-1"
              >
                <span className="text-[#4b5563] text-xs">{label}</span>
                <span className="text-[#c7cad4] text-xs font-semibold">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ACTIVITY */}
        <div>
          <p className={SECTION_CLASS}>Activity</p>
          <div className="h-16 flex items-end gap-0.75 px-1 bg-white/2 border border-white/6 rounded-lg overflow-hidden">
            {ACTIVITY_BARS.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[2px]"
                style={{ height: `${h}%`, background: `${accent}55` }}
              />
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 mt-auto pt-2">
          <button className="w-full py-2.25 text-xs font-semibold cursor-pointer border border-white/10 bg-white/4 text-[#c7cad4] rounded-lg hover:bg-white/7 transition-colors">
            + Add Model
          </button>
          <button className="w-full py-2.25 text-xs font-semibold cursor-pointer border-0 bg-[#6366f1] text-white rounded-lg hover:bg-[#5558e3] transition-colors">
            Edit Node
          </button>
        </div>
      </div>
    </div>
  )
}
