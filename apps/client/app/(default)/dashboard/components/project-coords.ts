export interface IsoPoint {
  x: number
  y: number
}

export function normalizeCoord(
  value: number,
  min: number,
  max: number,
): number {
  const range = max - min
  if (range === 0) return 0
  return (value - min) / range
}

export function getZoneOffset(index: number): { x: number; y: number } {
  const col = index % 2
  const row = Math.floor(index / 2)
  return { x: col * 280, y: row * 160 }
}

export function projectToIso(
  nodeX: number,
  nodeY: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  zoneOffsetX: number,
  zoneOffsetY: number,
  viewportCenterX: number,
  viewportCenterY: number,
): IsoPoint {
  const normX = normalizeCoord(nodeX, minX, maxX)
  const normY = normalizeCoord(nodeY, minY, maxY)
  const scaledX = normX * 200 + zoneOffsetX
  const scaledY = normY * 100 + zoneOffsetY
  const isoX = (scaledX - scaledY) * Math.cos(Math.PI / 6)
  const isoY = (scaledX + scaledY) * Math.sin(Math.PI / 6) * 0.5
  return { x: isoX + viewportCenterX, y: isoY + viewportCenterY }
}
