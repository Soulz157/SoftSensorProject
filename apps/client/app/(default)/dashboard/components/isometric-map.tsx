import { useMemo } from 'react'
import { MachineNode } from './machine-node'
import { projectToIso, getZoneOffset } from './project-coords'
import type { Workspace } from '@/types'
import type { CanvasNode } from '@/services/canvas'

const VIEWPORT_W = 700
const VIEWPORT_H = 420
const CX = VIEWPORT_W / 2
const CY = VIEWPORT_H / 2 - 20

// Tailwind bg class id → hex for SVG stroke
const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

interface IsometricMapProps {
  workspaces: Workspace[]
  nodes: CanvasNode[]
  selectedWorkspaceId: string | null
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
}

function getZoneFloorPath(offsetX: number, offsetY: number): string {
  const corners: [number, number][] = [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ]
  const pts = corners.map(([x, y]) => {
    const isoX = (x - y) * Math.cos(Math.PI / 6) + CX + offsetX * 0.7
    const isoY = (x + y) * Math.sin(Math.PI / 6) * 0.5 + CY + offsetY * 0.5
    return `${isoX},${isoY}`
  })
  return `M ${pts[0]} L ${pts[1]} L ${pts[2]} L ${pts[3]} Z`
}

export function IsometricMap({
  workspaces,
  nodes,
  selectedWorkspaceId,
  selectedNodeId,
  onNodeClick,
}: IsometricMapProps) {
  const nodesByWorkspace = useMemo(() => {
    const map = new Map<string, CanvasNode[]>()
    for (const node of nodes) {
      const arr = map.get(node.workspaceId) ?? []
      arr.push(node)
      map.set(node.workspaceId, arr)
    }
    return map
  }, [nodes])

  const projectedNodes = useMemo(() => {
    return workspaces.flatMap((ws, wsIndex) => {
      const wsNodes = nodesByWorkspace.get(ws.id) ?? []
      if (wsNodes.length === 0) return []

      const xs = wsNodes.map(n => n.data.x)
      const ys = wsNodes.map(n => n.data.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)

      const zoneOffset = getZoneOffset(wsIndex)

      return wsNodes.map(node => {
        const pt = projectToIso(
          node.data.x,
          node.data.y,
          minX,
          maxX,
          minY,
          maxY,
          zoneOffset.x,
          zoneOffset.y,
          CX,
          CY,
        )
        return { node, isoX: pt.x, isoY: pt.y, wsIndex }
      })
    })
  }, [workspaces, nodesByWorkspace])

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
      className="w-full h-full"
      style={{
        background:
          'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)',
      }}
    >
      {/* Zone floors */}
      {workspaces.map((ws, i) => {
        const zoneOffset = getZoneOffset(i)
        const accentHex = COLOR_HEX[ws.color ?? 'blue'] ?? '#3b82f6'
        const isSelected = selectedWorkspaceId === ws.id
        const strokeColor = isSelected ? accentHex : '#1e2230'
        const floorPath = getZoneFloorPath(
          zoneOffset.x - VIEWPORT_W / 2,
          zoneOffset.y - VIEWPORT_H / 2 + 20,
        )
        const labelX = CX + (zoneOffset.x - (VIEWPORT_W / 2 - 100)) * 0.4
        const labelY = CY + (zoneOffset.y - (VIEWPORT_H / 2 - 20)) * 0.3 - 20

        return (
          <g key={ws.id}>
            <path
              d={floorPath}
              fill={isSelected ? 'rgba(59,130,246,0.05)' : 'rgba(14,20,35,0.6)'}
              stroke={strokeColor}
              strokeWidth={isSelected ? 2 : 1}
              strokeDasharray={isSelected ? '0' : '8,5'}
            />
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill="#1e3a6e"
              letterSpacing={3}
              fontFamily="monospace"
            >
              {ws.name.toUpperCase()}
            </text>
          </g>
        )
      })}

      {/* Machine nodes */}
      {projectedNodes.map(({ node, isoX, isoY }) => (
        <MachineNode
          key={node.id}
          type={node.data.type}
          icon={node.data.icon}
          status={node.data.status}
          label={node.data.name}
          isoX={isoX}
          isoY={isoY}
          selected={selectedNodeId === node.id}
          onClick={() => onNodeClick(node.id)}
        />
      ))}
    </svg>
  )
}
