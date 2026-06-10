'use client'

import { useMemo, useState, useRef } from 'react'
import { Sun, Moon } from 'lucide-react'
import { MachineNode } from './machine-node'
import { calculateIsometricLayout } from '@/lib/isomatric'
import type { ZoneItem } from '@/lib/isomatric'
import type { CanvasNode } from '@/services/canvas'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTheme } from 'next-themes'

const VIEWPORT_W = 700
const VIEWPORT_H = 420
const CX = VIEWPORT_W / 2
const CY = VIEWPORT_H / 2 - 20

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

interface IsometricMapProps {
  zones: ZoneItem[]
  nodes: CanvasNode[]
  zoneNodeKey: 'planId' | 'workspaceId'
  selectedZoneId: string | null
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
  onZoneSelect?: (zoneId: string) => void
  onZoneDoubleClick?: (zoneId: string) => void
  viewMode?: 'plants' | 'equipment'
}

export function IsometricMap({
  zones,
  nodes,
  zoneNodeKey,
  selectedZoneId,
  selectedNodeId,
  onNodeClick,
  onZoneSelect,
  onZoneDoubleClick,
  viewMode,
}: IsometricMapProps) {
  const { resolvedTheme } = useTheme()
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isDark, setIsDark] = useState(resolvedTheme !== 'light')
  const dragStart = useRef({ x: 0, y: 0 })
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  const layoutData = useMemo(() => {
    const map = new Map<string, CanvasNode[]>()
    for (const node of nodes) {
      const key = node[zoneNodeKey]
      const arr = map.get(key) ?? []
      arr.push(node)
      map.set(key, arr)
    }
    return calculateIsometricLayout(zones, map, CX, CY)
  }, [zones, nodes, zoneNodeKey])

  const criticalAlerts = nodes.filter(n => n.data.status === 'alarm').length
  const warnings = nodes.filter(n => n.data.status === 'warning').length
  const activeZones = zones.length
  const overallHealth =
    criticalAlerts > 0 ? 'ALARM' : warnings > 0 ? 'WARNING' : 'HEALTHY'
  const healthColor =
    criticalAlerts > 0
      ? isDark
        ? '#ef4444'
        : '#dc2626'
      : warnings > 0
        ? isDark
          ? '#f59e0b'
          : '#d97706'
        : isDark
          ? '#10b981'
          : '#059669'

  const palette = isDark
    ? {
        bg: 'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)',
        topFillInactive: 'rgba(20, 28, 45, 0.85)',
        edgeFillInactive: '#0f172a',
        strokeInactive: '#1e2230',
        shadowFill: '#000000',
        labelFill: '#ffffff',
        labelStroke: '#0e1520',
        hoverTopFill: (hex: string) => `${hex}50`,
        hoverEdgeFill: (hex: string) => `${hex}90`,
      }
    : {
        bg: 'radial-gradient(ellipse at 50% 40%, #f0f4f8 0%, #dce8f0 80%)',
        topFillInactive: 'rgba(200, 215, 228, 0.70)',
        edgeFillInactive: '#cbd5e1',
        strokeInactive: '#475569',
        shadowFill: '#64748b',
        labelFill: '#1e293b',
        labelStroke: '#f0f4f8',
        hoverTopFill: (hex: string) => `${hex}40`,
        hoverEdgeFill: (hex: string) => `${hex}80`,
      }

  return (
    <TooltipProvider>
      <div className="relative h-full w-full">
        {/* HUD Status Box */}
        <div
          className={cn(
            'absolute top-3 left-3 z-10 rounded-xl border px-3 py-2.5 backdrop-blur-sm',
            isDark
              ? 'bg-black/40 border-white/10 text-white'
              : 'bg-white/80 border-black/10 text-gray-900',
          )}
        >
          <div className="mb-2 text-[9px] font-bold uppercase tracking-widest opacity-60">
            System Status
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: healthColor }}
              />
              <span
                className="text-[11px] font-semibold"
                style={{ color: healthColor }}
              >
                {overallHealth}
              </span>
            </div>
            <div
              className={cn(
                'text-[11px]',
                isDark ? 'text-white/60' : 'text-gray-600',
              )}
            >
              <span
                className="font-semibold"
                style={{ color: isDark ? '#fff' : '#111' }}
              >
                {activeZones}
              </span>{' '}
              Active Zones
            </div>
            <div
              className={cn(
                'text-[11px]',
                isDark ? 'text-white/60' : 'text-gray-600',
              )}
            >
              <span
                className="font-semibold"
                style={{
                  color:
                    criticalAlerts > 0 ? '#ef4444' : isDark ? '#fff' : '#111',
                }}
              >
                {criticalAlerts}
              </span>{' '}
              Critical Alerts
            </div>
          </div>
        </div>

        {/* Canva-style theme toggle */}
        <div className="absolute top-3 right-3 z-10 flex items-center rounded-full bg-black/30 p-0.5 backdrop-blur-sm">
          <button
            onClick={() => setIsDark(false)}
            aria-label="Light mode"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200',
              !isDark
                ? 'bg-white/90 text-gray-900 shadow-sm'
                : 'text-white/60 hover:text-white/90',
            )}
          >
            <Sun className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsDark(true)}
            aria-label="Dark mode"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200',
              isDark
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-white/60 hover:text-white/90',
            )}
          >
            <Moon className="h-3.5 w-3.5" />
          </button>
        </div>

        <svg
          width="100%"
          height="100%"
          viewBox={` 0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
          className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ background: palette.bg }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <g transform={`translate(${pan.x}, ${pan.y})`}>
            {layoutData.map(
              ({ zone, mappedNodes, floorPath, labelX, labelY }) => {
                const accentHex = COLOR_HEX[zone.color ?? 'blue'] ?? '#3b82f6'
                const isSelected = selectedZoneId === zone.id
                const isHovered = hoveredZoneId === zone.id
                const strokeColor =
                  isSelected || isHovered ? accentHex : palette.strokeInactive

                const alarmCount = mappedNodes.filter(
                  m => m.node.data.status === 'alarm',
                ).length
                const warningCount = mappedNodes.filter(
                  m => m.node.data.status === 'warning',
                ).length

                let zoneStatusText = 'NORMAL'
                let zoneStatusColor = '#10b981'

                if (alarmCount > 0) {
                  zoneStatusText = `${alarmCount} ALARM`
                  zoneStatusColor = '#ef4444'
                } else if (warningCount > 0) {
                  zoneStatusText = `${warningCount} WARNING`
                  zoneStatusColor = '#f59e0b'
                }

                return (
                  <g key={zone.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <g
                          className="cursor-pointer transition-all duration-300"
                          onMouseEnter={() =>
                            !isDragging && setHoveredZoneId(zone.id)
                          }
                          onMouseLeave={() => setHoveredZoneId(null)}
                          onClick={() => !isDragging && onZoneSelect?.(zone.id)}
                          onDoubleClick={e => {
                            e.preventDefault()
                            if (!isDragging) onZoneDoubleClick?.(zone.id)
                          }}
                        >
                          {(() => {
                            const topFill = isSelected
                              ? `${accentHex}40`
                              : isHovered
                                ? palette.hoverTopFill(accentHex)
                                : palette.topFillInactive

                            const edgeFill = isSelected
                              ? `${accentHex}80`
                              : isHovered
                                ? palette.hoverEdgeFill(accentHex)
                                : palette.edgeFillInactive

                            const floorThickness = 12

                            return (
                              <>
                                <g
                                  style={{
                                    transform: `translateY(${isHovered ? -3 : 0}px)`,
                                    transition: 'transform 0.3s ease',
                                  }}
                                >
                                  <path
                                    d={floorPath}
                                    fill={palette.shadowFill}
                                    style={{
                                      filter: isHovered
                                        ? 'blur(15px)'
                                        : 'blur(8px)',
                                      transform: `translateY(${floorThickness + (isHovered ? 15 : 5)}px)`,
                                      opacity: isHovered ? 0.4 : 0.6,
                                      transition: 'all 0.5s ease-out',
                                    }}
                                  />

                                  {Array.from({ length: floorThickness }).map(
                                    (_, i) => (
                                      <path
                                        key={`edge-${i}`}
                                        d={floorPath}
                                        fill={edgeFill}
                                        stroke={edgeFill}
                                        strokeWidth="0.5"
                                        transform={`translate(0, ${i + 1})`}
                                        className="transition-colors duration-300"
                                      />
                                    ),
                                  )}

                                  <path
                                    d={floorPath}
                                    fill={topFill}
                                    stroke={strokeColor}
                                    strokeWidth={
                                      isSelected || isHovered ? 2.5 : 1.5
                                    }
                                    strokeDasharray={isSelected ? '0' : '8,5'}
                                    className="transition-colors duration-300"
                                  />
                                </g>
                              </>
                            )
                          })()}
                        </g>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="border-border bg-card text-foreground"
                      >
                        <div className="flex flex-col gap-1 text-sm">
                          <span className="font-semibold text-primary">
                            {zone.name} Zone
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {mappedNodes.length} Devices
                          </span>
                          {alarmCount > 0 && (
                            <span className="text-xs font-medium text-red-500">
                              {alarmCount} Devices in Alarm
                            </span>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>

                    {mappedNodes.map(({ node, isoX, isoY }) => (
                      <MachineNode
                        key={node.id}
                        type={node.data.type}
                        icon={node.data.icon}
                        status={node.data.status}
                        label={node.data.name}
                        isoX={isoX}
                        isoY={isoY}
                        selected={selectedNodeId === node.id}
                        onClick={() => !isDragging && onNodeClick(node.id)}
                        isViewMode={viewMode === 'equipment'}
                      />
                    ))}

                    {viewMode === 'plants' && (
                      <g style={{ pointerEvents: 'none' }}>
                        <text
                          x={labelX}
                          y={labelY - 100}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight={800}
                          fill={
                            isSelected || isHovered
                              ? accentHex
                              : palette.labelFill
                          }
                          stroke={palette.labelStroke}
                          strokeWidth="4"
                          paintOrder="stroke fill"
                          letterSpacing={3}
                          fontFamily="monospace"
                        >
                          {zone.name.toUpperCase()}
                        </text>

                        <g transform={`translate(${labelX}, ${labelY + 5})`}>
                          <rect
                            x="-35"
                            y="-100"
                            width="70"
                            height="16"
                            rx="8"
                            fill={`${zoneStatusColor}20`}
                            stroke={zoneStatusColor}
                            strokeWidth="1"
                          />
                          <circle
                            cx="-25"
                            cy="-92"
                            r="3"
                            fill={zoneStatusColor}
                          />
                          <text
                            x="3"
                            y="-89"
                            textAnchor="middle"
                            fontSize={8}
                            fontWeight="bold"
                            fill={zoneStatusColor}
                          >
                            {zoneStatusText}
                          </text>
                        </g>
                      </g>
                    )}
                  </g>
                )
              },
            )}
          </g>
        </svg>
      </div>
    </TooltipProvider>
  )
}
