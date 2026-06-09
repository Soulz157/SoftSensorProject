import type { CanvasNode } from '@/services/canvas'

export const GRID_SPACING = 80
export const MIN_ZONE_SIZE = 150

export const ZONE_MARGIN = 80
export const ZONES_PER_ROW = 2

export interface ZoneItem {
  id: string
  name: string
  color?: string
}

export interface MappedNode {
  node: CanvasNode
  isoX: number
  isoY: number
}

export interface ZoneLayoutData {
  zone: ZoneItem
  zoneWidth: number
  zoneHeight: number
  mappedNodes: MappedNode[]
  floorPath: string
  labelX: number
  labelY: number
}

export function getZoneFloorPath(
  startX: number,
  startY: number,
  width: number,
  height: number,
  CX: number,
  CY: number,
): string {
  const corners: [number, number][] = [
    [startX, startY],
    [startX + width, startY],
    [startX + width, startY + height],
    [startX, startY + height],
  ]
  const pts = corners.map(([x, y]) => {
    const isoX = (x - y) * Math.cos(Math.PI / 6) + CX
    const isoY = (x + y) * Math.sin(Math.PI / 6) * 0.5 + CY
    return `${isoX},${isoY}`
  })
  return `M ${pts[0]} L ${pts[1]} L ${pts[2]} L ${pts[3]} Z`
}

export function calculateIsometricLayout(
  zones: ZoneItem[],
  nodesByZone: Map<string, CanvasNode[]>,
  CX: number,
  CY: number,
): ZoneLayoutData[] {
  let currentX = 0
  let currentY = 0
  let rowMaxHeight = 0

  return zones.map((zone, index) => {
    const zoneNodes = nodesByZone.get(zone.id) ?? []
    const nodeCount = zoneNodes.length

    let zoneWidth = MIN_ZONE_SIZE
    let zoneHeight = MIN_ZONE_SIZE
    let mappedNodes: MappedNode[] = []

    if (nodeCount > 0) {
      const cols = Math.max(2, Math.ceil(Math.sqrt(nodeCount)))
      const rows = Math.ceil(nodeCount / cols)

      zoneWidth = Math.max(MIN_ZONE_SIZE, cols * GRID_SPACING + 40)
      zoneHeight = Math.max(MIN_ZONE_SIZE, rows * GRID_SPACING + 40)

      mappedNodes = zoneNodes.map((node, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)

        const localX = currentX + col * GRID_SPACING + GRID_SPACING / 2 + 20
        const localY = currentY + row * GRID_SPACING + GRID_SPACING / 2 + 20

        const isoX = (localX - localY) * Math.cos(Math.PI / 6) + CX
        const isoY = (localX + localY) * Math.sin(Math.PI / 6) * 0.5 + CY

        return { node, isoX, isoY }
      })
    }

    const floorPath = getZoneFloorPath(
      currentX,
      currentY,
      zoneWidth,
      zoneHeight,
      CX,
      CY,
    )

    const center2DX = currentX + zoneWidth / 2
    const center2DY = currentY + zoneHeight / 2
    const labelX = (center2DX - center2DY) * Math.cos(Math.PI / 6) + CX
    const labelY = (center2DX + center2DY) * Math.sin(Math.PI / 6) * 0.5 + CY

    const layoutData = {
      zone,
      zoneWidth,
      zoneHeight,
      mappedNodes,
      floorPath,
      labelX,
      labelY,
    }

    rowMaxHeight = Math.max(rowMaxHeight, zoneHeight)
    currentX += zoneWidth + ZONE_MARGIN

    if ((index + 1) % ZONES_PER_ROW === 0) {
      currentX = 0
      currentY += rowMaxHeight + ZONE_MARGIN
      rowMaxHeight = 0
    }

    return layoutData
  })
}
