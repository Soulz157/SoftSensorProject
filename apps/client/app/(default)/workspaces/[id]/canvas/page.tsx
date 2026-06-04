'use client'

import { useState, use, useRef } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Box,
  X,
  Cpu,
  Thermometer,
  Gauge,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pencil,
  Trash2,
  Plus,
  Wrench,
  ArrowRight,
  ChevronRight,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'
import { useWorkspaceModels } from '@/hooks/workspace/use-workspace-models'

interface Node {
  id: string
  name: string
  type: 'machine' | 'sensor' | 'controller'
  x: number
  y: number
  status: 'normal' | 'warning' | 'alarm' | 'offline'
  models: {
    id: string
    name: string
    status: 'running' | 'warning' | 'error' | 'stopped'
    accuracy?: string
  }[]
}

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { workspace, loading: workspaceLoading } = useWorkspace(id)
  const { models: workspaceModels } = useWorkspaceModels(id)

  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [zoom, setZoom] = useState(1)
  const [buildMode, setBuildMode] = useState(false)

  const [editingNode, setEditingNode] = useState<Node | null>(null)
  const [editForm, setEditForm] = useState<{
    name: string
    type: Node['type']
    status: Node['status']
  }>({ name: '', type: 'machine', status: 'normal' })

  const [deletingNode, setDeletingNode] = useState<Node | null>(null)

  const [addingNode, setAddingNode] = useState(false)
  const [addNodeForm, setAddNodeForm] = useState<{
    name: string
    type: Node['type']
  }>({ name: '', type: 'machine' })

  const [showModelActions, setShowModelActions] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragMoved = useRef(false)
  const [dragging, setDragging] = useState<{
    nodeId: string
    startMouseX: number
    startMouseY: number
    startNodeX: number
    startNodeY: number
  } | null>(null)

  const handleNodeMouseDown = (node: Node, e: React.MouseEvent) => {
    e.preventDefault()
    dragMoved.current = false
    setDragging({
      nodeId: node.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    })
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !canvasRef.current) return
    const pixelDeltaX = e.clientX - dragging.startMouseX
    const pixelDeltaY = e.clientY - dragging.startMouseY
    if (Math.abs(pixelDeltaX) < 5 && Math.abs(pixelDeltaY) < 5) return
    const rect = canvasRef.current.getBoundingClientRect()
    const deltaX = (pixelDeltaX / rect.width) * 100
    const deltaY = (pixelDeltaY / rect.height) * 100
    const newX = Math.min(96, Math.max(2, dragging.startNodeX + deltaX))
    const newY = Math.min(96, Math.max(2, dragging.startNodeY + deltaY))
    dragMoved.current = true
    setNodes(prev =>
      prev.map(n =>
        n.id === dragging.nodeId ? { ...n, x: newX, y: newY } : n,
      ),
    )
  }

  const handleCanvasMouseUp = () => {
    setDragging(null)
    dragMoved.current = false
  }

  const [addModelDialog, setAddModelDialog] = useState(false)
  const [addModelForm, setAddModelForm] = useState({
    nodeId: '',
    modelId: '',
  })

  const openEditNode = (node: Node, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditForm({ name: node.name, type: node.type, status: node.status })
    setEditingNode(node)
  }

  const saveEditNode = () => {
    if (!editingNode) return
    const updated = nodes.map(n =>
      n.id === editingNode.id ? { ...n, ...editForm } : n,
    )
    setNodes(updated)
    if (selectedNode?.id === editingNode.id) {
      setSelectedNode({ ...editingNode, ...editForm })
    }
    setEditingNode(null)
  }

  const openDeleteNode = (node: Node, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingNode(node)
  }

  const confirmDeleteNode = () => {
    if (!deletingNode) return
    setNodes(nodes.filter(n => n.id !== deletingNode.id))
    if (selectedNode?.id === deletingNode.id) setSelectedNode(null)
    setDeletingNode(null)
  }

  const saveAddNode = () => {
    if (!addNodeForm.name.trim()) return
    const newNode: Node = {
      id: `n${Date.now()}`,
      name: addNodeForm.name,
      type: addNodeForm.type,
      x: Math.floor(Math.random() * 55) + 20,
      y: Math.floor(Math.random() * 55) + 20,
      status: 'normal',
      models: [],
    }
    setNodes([...nodes, newNode])
    setAddingNode(false)
    setAddNodeForm({ name: '', type: 'machine' })
  }

  const saveAddModel = () => {
    if (!addModelForm.nodeId || !addModelForm.modelId) return
    const model = workspaceModels?.find(m => m.id === addModelForm.modelId)
    if (!model) return
    const newModel = {
      id: model.id,
      name: model.name,
      status: 'stopped' as const,
    }
    setNodes(
      nodes.map(n =>
        n.id === addModelForm.nodeId
          ? { ...n, models: [...n.models, newModel] }
          : n,
      ),
    )
    if (selectedNode?.id === addModelForm.nodeId) {
      setSelectedNode(prev =>
        prev ? { ...prev, models: [...prev.models, newModel] } : prev,
      )
    }
    setAddModelDialog(false)
    setAddModelForm({ nodeId: '', modelId: '' })
    setShowModelActions(false)
  }

  const getNodeIcon = (type: Node['type']) => {
    switch (type) {
      case 'machine':
        return <Cpu className="h-5 w-5" />
      case 'sensor':
        return <Thermometer className="h-5 w-5" />
      case 'controller':
        return <Gauge className="h-5 w-5" />
    }
  }

  const getStatusColor = (status: Node['status']) => {
    switch (status) {
      case 'normal':
        return 'bg-emerald-500'
      case 'warning':
        return 'bg-amber-500'
      case 'alarm':
        return 'bg-red-500'
      case 'offline':
        return 'bg-zinc-500'
    }
  }

  const getModelStatusColor = (status: Node['models'][number]['status']) => {
    switch (status) {
      case 'running':
        return 'bg-emerald-500'
      case 'warning':
        return 'bg-amber-500'
      case 'error':
        return 'bg-red-500'
      case 'stopped':
        return 'bg-zinc-500'
    }
  }

  const getModelStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      case 'stopped':
        return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
      case 'error':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    }
  }

  const inputClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Canvas Area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div
          className={`flex items-center justify-between border-b border-border px-4 py-2 transition-colors ${
            buildMode ? 'bg-amber-500/10 border-amber-500/30' : 'bg-card'
          }`}
        >
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {workspaceLoading ? (
                <div className="h-5 w-40 animate-pulse rounded bg-muted" />
              ) : (
                (workspace?.name ?? 'Workspace')
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {nodes.length} nodes
              {buildMode
                ? ' — Build Mode active'
                : ' — Click a node to view details'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={buildMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBuildMode(!buildMode)}
              className={`gap-1.5 mr-2 ${buildMode ? 'bg-amber-500 hover:bg-amber-600 text-white border-transparent' : ''}`}
            >
              <Wrench className="h-3.5 w-3.5" />
              {buildMode ? 'Exit Build Mode' : 'Build Mode'}
            </Button>

            {buildMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingNode(true)}
                className="gap-1.5 mr-2 border-dashed"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Node
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom(Math.min(zoom + 0.2, 2))}
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom(Math.max(zoom - 0.2, 0.5))}
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setZoom(1)}
              title="Reset View"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Fullscreen">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="flex-1 relative overflow-hidden bg-muted/30"
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `
                  linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px),
                  linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)
                `,
              backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
            }}
          />

          <div
            ref={canvasRef}
            className="absolute inset-4 border-2 border-dashed border-border/50 rounded-lg"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    className="fill-primary/30"
                  />
                </marker>
              </defs>
              {nodes.map((node, i) => {
                if (i === nodes.length - 1) return null
                const nextNode = nodes[i + 1]
                return (
                  <line
                    key={`line-${node.id}`}
                    x1={`${node.x}%`}
                    y1={`${node.y}%`}
                    x2={`${nextNode?.x}%`}
                    y2={`${nextNode?.y}%`}
                    className="stroke-primary/20"
                    strokeWidth="2"
                    strokeDasharray="8 4"
                  />
                )
              })}
            </svg>

            {nodes.map(node => (
              <div
                key={node.id}
                className="absolute"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <button
                  onClick={() => {
                    if (dragMoved.current) return
                    if (!buildMode) setSelectedNode(node)
                  }}
                  onMouseDown={e => {
                    if (buildMode) handleNodeMouseDown(node, e)
                  }}
                  className={`relative flex flex-col items-center gap-2 p-3 rounded-lg min-w-35 transition-all ${
                    !buildMode ? 'hover:scale-110' : ''
                  } ${
                    selectedNode?.id === node.id
                      ? 'bg-primary/20 ring-2 ring-primary'
                      : buildMode
                        ? 'bg-card ring-2 ring-amber-500/40'
                        : 'bg-card hover:bg-accent'
                  } border border-border shadow-lg ${
                    buildMode
                      ? dragging?.nodeId === node.id
                        ? 'cursor-grabbing'
                        : 'cursor-grab'
                      : ''
                  }`}
                >
                  <div className="relative">
                    <div
                      className={`p-2 rounded-md ${
                        node.status === 'normal'
                          ? 'bg-primary/10 text-primary'
                          : node.status === 'warning'
                            ? 'bg-amber-500/10 text-amber-500'
                            : node.status === 'alarm'
                              ? 'bg-red-500/10 text-red-500'
                              : 'bg-zinc-500/10 text-zinc-500'
                      }`}
                    >
                      {getNodeIcon(node.type)}
                    </div>
                    <span
                      className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ${getStatusColor(node.status)} ring-2 ring-card`}
                    />
                  </div>
                  <span className="text-xs font-bold text-foreground whitespace-nowrap max-w-32 truncate">
                    {node.name}
                  </span>
                  {node.models.length > 0 && (
                    <div className="w-full flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {node.models.length} model
                        {node.models.length > 1 ? 's' : ''}
                      </span>
                      <div className="flex items-center gap-1">
                        {node.models.map(m => (
                          <span
                            key={m.id}
                            title={`${m.name} — ${m.status}`}
                            className={`h-2 w-2 rounded-full ${getModelStatusColor(m.status)} ring-1 ring-card`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </button>

                {buildMode && (
                  <div className="absolute -top-3 -right-3 flex gap-1">
                    <button
                      onClick={e => openEditNode(node, e)}
                      className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:bg-primary/80 transition-colors"
                      title="Edit node"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={e => openDeleteNode(node, e)}
                      className="h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow hover:bg-destructive/80 transition-colors"
                      title="Delete node"
                    >
                      <Trash2 className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Bottom-left Interactive Box */}
          <div className="absolute bottom-4 left-4 z-10">
            <div className="bg-card/95 backdrop-blur-sm rounded-lg border border-border shadow-lg overflow-hidden">
              <button
                onClick={() => setShowModelActions(!showModelActions)}
                className="flex items-center justify-between w-full px-3 py-2 hover:bg-accent/50 transition-colors"
              >
                <p className="text-xs font-medium text-foreground">
                  {showModelActions ? 'Actions' : 'Legend'}
                </p>
                <ChevronRight
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                    showModelActions ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {!showModelActions && (
                <div className="px-3 pb-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Normal
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    Warning
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    Alarm
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-zinc-500" />
                    Offline
                  </div>
                </div>
              )}

              {showModelActions && (
                <div className="px-3 pb-3 space-y-2">
                  <button
                    onClick={() => {
                      setAddModelForm({
                        nodeId: nodes[0]?.id ?? '',
                        modelId: '',
                      })
                      setAddModelDialog(true)
                    }}
                    className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs font-medium text-foreground bg-primary/10 hover:bg-primary/20 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    Add Model to Node
                  </button>
                  <button
                    onClick={() => {
                      setBuildMode(true)
                      setShowModelActions(false)
                    }}
                    className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs font-medium text-foreground bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                  >
                    <Wrench className="h-3.5 w-3.5 text-amber-500" />
                    Enter Build Mode
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Node Details Panel */}
      {selectedNode && !buildMode && (
        <div className="w-80 border-l border-border bg-card flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-md ${
                  selectedNode.status === 'normal'
                    ? 'bg-primary/10 text-primary'
                    : selectedNode.status === 'warning'
                      ? 'bg-amber-500/10 text-amber-500'
                      : selectedNode.status === 'alarm'
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-zinc-500/10 text-zinc-500'
                }`}
              >
                {getNodeIcon(selectedNode.type)}
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  {selectedNode.name}
                </h3>
                <p className="text-xs text-muted-foreground capitalize">
                  {selectedNode.type}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedNode(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            <Card className="border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </CardTitle>
              </CardHeader>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${getStatusColor(selectedNode.status)}`}
                  />
                  <span className="text-sm font-medium text-foreground capitalize">
                    {selectedNode.status}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  AI Models ({selectedNode.models.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 px-4">
                {selectedNode.models.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No models assigned
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedNode.models.map(model => (
                      <Link
                        key={model.id}
                        href={`/models/${model.id}`}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-primary/10 transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <Box className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                          <div>
                            <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                              {model.name}
                            </p>
                            {model.accuracy && (
                              <p className="text-[10px] text-muted-foreground">
                                {model.accuracy} accuracy
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {getModelStatusIcon(model.status)}
                          <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Quick Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="py-3 px-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Uptime</span>
                  <span className="text-xs font-medium text-foreground">
                    99.8%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Last Update
                  </span>
                  <span className="text-xs font-medium text-foreground">
                    2 min ago
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Data Points
                  </span>
                  <span className="text-xs font-medium text-foreground">
                    1.2M
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="py-3 px-4">
                <div className="flex items-end gap-1 h-16">
                  {[40, 65, 45, 80, 55, 70, 85, 60, 75, 50, 90, 65].map(
                    (height, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-primary/20 rounded-t"
                        style={{ height: `${height}%` }}
                      />
                    ),
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 text-center">
                  Last 12 hours
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="p-4 border-t border-border space-y-2">
            <Button
              className="w-full"
              size="sm"
              onClick={() => {
                setAddModelForm({ nodeId: selectedNode.id, modelId: '' })
                setAddModelDialog(true)
              }}
              variant="outline"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Model
            </Button>
            <Button
              className="w-full"
              size="sm"
              onClick={e => openEditNode(selectedNode, e)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit Node
            </Button>
          </div>
        </div>
      )}

      {/* Edit Node Dialog */}
      <Dialog open={!!editingNode} onOpenChange={() => setEditingNode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Node</DialogTitle>
            <DialogDescription>
              Update the node name, type, and status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Name
              </label>
              <input
                className={inputClass}
                value={editForm.name}
                onChange={e =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
                placeholder="Node name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Type
              </label>
              <select
                className={inputClass}
                value={editForm.type}
                onChange={e =>
                  setEditForm({
                    ...editForm,
                    type: e.target.value as Node['type'],
                  })
                }
              >
                <option value="machine">Machine</option>
                <option value="sensor">Sensor</option>
                <option value="controller">Controller</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Status
              </label>
              <select
                className={inputClass}
                value={editForm.status}
                onChange={e =>
                  setEditForm({
                    ...editForm,
                    status: e.target.value as Node['status'],
                  })
                }
              >
                <option value="normal">Normal</option>
                <option value="warning">Warning</option>
                <option value="alarm">Alarm</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingNode(null)}>
              Cancel
            </Button>
            <Button onClick={saveEditNode} disabled={!editForm.name.trim()}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Node Dialog */}
      <Dialog open={!!deletingNode} onOpenChange={() => setDeletingNode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {deletingNode?.name}
              </span>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingNode(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteNode}>
              Delete Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Node Dialog */}
      <Dialog open={addingNode} onOpenChange={setAddingNode}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Node</DialogTitle>
            <DialogDescription>
              Add a new machine, sensor, or controller to this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Name
              </label>
              <input
                className={inputClass}
                value={addNodeForm.name}
                onChange={e =>
                  setAddNodeForm({ ...addNodeForm, name: e.target.value })
                }
                placeholder="e.g. Hydraulic Press D1"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Type
              </label>
              <select
                className={inputClass}
                value={addNodeForm.type}
                onChange={e =>
                  setAddNodeForm({
                    ...addNodeForm,
                    type: e.target.value as Node['type'],
                  })
                }
              >
                <option value="machine">Machine</option>
                <option value="sensor">Sensor</option>
                <option value="controller">Controller</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingNode(false)}>
              Cancel
            </Button>
            <Button onClick={saveAddNode} disabled={!addNodeForm.name.trim()}>
              Add Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Model to Node Dialog */}
      <Dialog open={addModelDialog} onOpenChange={setAddModelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Model to Node</DialogTitle>
            <DialogDescription>
              Assign an AI model to a node in this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Node
              </label>
              <select
                className={inputClass}
                value={addModelForm.nodeId}
                onChange={e =>
                  setAddModelForm({ ...addModelForm, nodeId: e.target.value })
                }
              >
                <option value="">Select a node…</option>
                {nodes.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Model
              </label>
              <select
                className={inputClass}
                value={addModelForm.modelId}
                onChange={e =>
                  setAddModelForm({ ...addModelForm, modelId: e.target.value })
                }
                disabled={!workspaceModels || workspaceModels.length === 0}
              >
                <option value="">
                  {!workspaceModels
                    ? 'Loading models…'
                    : workspaceModels.length === 0
                      ? 'No models available'
                      : 'Select a model…'}
                </option>
                {(workspaceModels ?? []).map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModelDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveAddModel}
              disabled={!addModelForm.nodeId || !addModelForm.modelId}
            >
              Add Model
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
