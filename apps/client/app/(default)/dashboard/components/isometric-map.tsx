'use client'

import { useMemo, useState, useRef } from 'react'
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
}

export function IsometricMap({
  zones,
  nodes,
  zoneNodeKey,
  selectedZoneId,
  selectedNodeId,
  onNodeClick,
  onZoneSelect,
}: IsometricMapProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
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

  return (
    <TooltipProvider>
      <svg
        width="100%"
        height="100%"
        viewBox={` 0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          background:
            'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)',
        }}
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
                isSelected || isHovered ? accentHex : '#1e2230'

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
                      >
                        <path
                          d={floorPath}
                          fill={
                            isSelected
                              ? `${accentHex}20`
                              : isHovered
                                ? `${accentHex}10`
                                : 'rgba(14,20,35,0.6)'
                          }
                          stroke={strokeColor}
                          strokeWidth={isSelected || isHovered ? 2 : 1}
                          strokeDasharray={isSelected ? '0' : '8,5'}
                        />
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
                    />
                  ))}

                  <g style={{ pointerEvents: 'none' }}>
                    <text
                      x={labelX}
                      y={labelY - 100}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={800}
                      fill={isSelected || isHovered ? accentHex : '#ffffff'}
                      stroke="#0e1520"
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
                      <circle cx="-25" cy="-92" r="3" fill={zoneStatusColor} />
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
                </g>
              )
            },
          )}
        </g>
      </svg>
    </TooltipProvider>
  )
}
