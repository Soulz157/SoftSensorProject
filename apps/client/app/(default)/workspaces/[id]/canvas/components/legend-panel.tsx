'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const LEGEND = [
  { color: '#22c55e', label: 'Normal' },
  { color: '#f97316', label: 'Warning' },
  { color: '#ef4444', label: 'Alarm' },
  { color: '#6b7280', label: 'Offline' },
] as const

export function LegendPanel() {
  const [open, setOpen] = useState(true)

  return (
    <div
      className={cn(
        'absolute bottom-4 left-14 z-10 bg-[#111320] border border-[#1e2235] rounded-[10px] min-w-32.5 select-none px-3.5 pt-2.5',
        open ? 'pb-3' : 'pb-2.5',
      )}
    >
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center justify-between w-full bg-transparent border-none cursor-pointer p-0 gap-2"
      >
        <span className="text-[rgba(255,255,255,0.4)] text-[10px] font-bold tracking-widest uppercase">
          Legend
        </span>
        {open ? (
          <ChevronDown size={12} color="rgba(255,255,255,0.3)" />
        ) : (
          <ChevronUp size={12} color="rgba(255,255,255,0.3)" />
        )}
      </button>

      {open && (
        <div className="mt-2.5 flex flex-col gap-1.75">
          {LEGEND.map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: color }}
              />
              <span className="text-[#9ca3af] text-[11px]">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
