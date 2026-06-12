'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5

export function useMapViewport(vbCX: number, vbCY: number) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [zoom, setZoom] = useState(1.0)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null,
  )

  const dragStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Native wheel listener — passive:false required to call preventDefault
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true)
      setHoverPos(null)
      dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPan({
          x: e.clientX - dragStart.current.x,
          y: e.clientY - dragStart.current.y,
        })
        return
      }
      if (hoveredId && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }
    },
    [isDragging, hoveredId],
  )

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  const handleTowerLeave = useCallback(() => {
    setHoveredId(null)
    setHoverPos(null)
  }, [])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      setIsDragging(true)
      dragStart.current = {
        x: touch.clientX - pan.x,
        y: touch.clientY - pan.y,
      }
    },
    [pan],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return
      const touch = e.touches[0]
      if (!touch) return
      setPan({
        x: touch.clientX - dragStart.current.x,
        y: touch.clientY - dragStart.current.y,
      })
    },
    [isDragging],
  )

  const handleTouchEnd = useCallback(() => setIsDragging(false), [])

  const zoomIn = useCallback(
    () => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP)),
    [],
  )
  const zoomOut = useCallback(
    () => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP)),
    [],
  )
  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const groupTransform = `translate(${pan.x + vbCX},${pan.y + vbCY}) scale(${zoom}) translate(${-vbCX},${-vbCY})`

  return {
    pan,
    zoom,
    isDragging,
    hoveredId,
    setHoveredId,
    hoverPos,
    containerRef,
    svgRef,
    groupTransform,
    handleTowerLeave,
    zoomIn,
    zoomOut,
    resetView,
    svgHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  }
}
