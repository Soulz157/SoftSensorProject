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

/**
 * Compute the SVG bounding box of an isometric layout, accounting for tower
 * height above each zone's label center. Returns { x, y, w, h } as a viewBox.
 */
export function computeLayoutBoundingBox(
  layout: ZoneLayoutData[],
  towerHeadroom = 160,
  padding = 60,
): { x: number; y: number; w: number; h: number } {
  if (layout.length === 0) {
    return { x: 0, y: 0, w: 700, h: 420 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const { floorPath, labelY } of layout) {
    for (const match of floorPath.matchAll(/([-\d.]+),([-\d.]+)/g)) {
      const x = Number(match[1])
      const y = Number(match[2])
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    // Tower + antenna + name badge extend above the floor label center
    const towerTop = labelY - towerHeadroom
    if (towerTop < minY) minY = towerTop
  }

  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2,
  }
}

export function calculateIsometricLayout(
  zones: ZoneItem[],
  nodesByZone: Map<string, CanvasNode[]>,
  CX: number,
  CY: number,
  zonesPerRow?: number,
): ZoneLayoutData[] {
  // Dynamic columns: ~square grid so all zones fit without vertical overflow
  const _zonesPerRow =
    zonesPerRow ?? Math.max(2, Math.ceil(Math.sqrt(zones.length)))

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

    if ((index + 1) % _zonesPerRow === 0) {
      currentX = 0
      currentY += rowMaxHeight + ZONE_MARGIN
      rowMaxHeight = 0
    }

    return layoutData
  })
}
