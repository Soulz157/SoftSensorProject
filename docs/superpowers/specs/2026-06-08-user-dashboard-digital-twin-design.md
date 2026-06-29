# Design Spec: User Dashboard — 2.5D Digital Twin

**Date:** 2026-06-08  
**Status:** Approved  
**Pattern:** Command Center (A)

---

## Context

The old `(default)/dashboard/` was deleted and its components moved to `app/admin/dashboard/`. Regular users now have no `/dashboard` route — authenticated users hit a 404 after login. This spec defines a new isometric Digital Twin dashboard at `(default)/dashboard/` that replaces the old KPI-card layout with a 2.5D interactive factory floor map.

---

## Layout: Command Center

Three-column layout. No tabs, no scroll — everything visible at once.

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER: Logo · Search · Global Status Badge · User Avatar      │
├──────────────┬──────────────────────────────┬───────────────────┤
│  LEFT (160px)│   CENTER (flex-1)            │  RIGHT (200px)    │
│              │                              │                   │
│  Workspace   │   Isometric 2.5D Map         │  Detail Panel     │
│  List        │   (SVG canvas)               │  (selected node)  │
│              │                              │                   │
│  Status      │   Nodes positioned by x,y   │  Node name        │
│  Filters     │   from canvas coords         │  AI Models        │
│              │                              │  Anomalies        │
│              │                              │  CTA buttons      │
├──────────────┴──────────────────────────────┴───────────────────┤
│  LEGEND BAR: machine type icons + status color key              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. `DashboardPage` — `app/(default)/dashboard/page.tsx`

- `"use client"` — needs hooks + interaction
- Fetches workspaces via `useWorkspaces()` (already loads `alarmCount`, `status` per workspace)
- Fetches nodes for ALL workspaces via `getNodes(workspaceId)` (parallel `Promise.all`)
- State: `selectedWorkspaceId: string | null`, `selectedNodeId: string | null`

### 2. `DashboardHeader` — `app/(default)/dashboard/components/dashboard-header.tsx`

- Global status badge: "All Systems Healthy" (green) or "N Active Alarms" (pulsing red)
- Search bar (filters nodes by name — local filter, no API call)
- User avatar

### 3. `IsometricMap` — `app/(default)/dashboard/components/isometric-map.tsx`

- SVG canvas. Zone floors drawn as parallelogram paths per workspace (isometric diamond shape, colored by workspace color token via stroke)
- Zones auto-positioned on an offset grid — no spatial data on `Workspace`. Layout: workspaces placed in rows of 2, each zone offset `(col * 280, row * 160)` in iso space. Max ~6 zones visible without scroll.
- Each node rendered as `<MachineNode>` at isometric-projected position within its zone
- Zone label (workspace name) floating above floor
- Active workspace highlight: blue dashed border on zone floor shape
- Props: `workspaces`, `nodes`, `selectedWorkspaceId`, `selectedNodeId`, `onNodeClick`

### 4. `MachineNode` — `app/(default)/dashboard/components/machine-node.tsx`

- Self-contained SVG group. Props: `type`, `icon`, `status`, `label`, `x`, `y`, `selected`, `onClick`
- `NodeData.type` has 3 values: `machine | sensor | controller`. `NodeData.icon` (optional string) disambiguates machine subtypes.
- Resolution order:
  - `type === 'sensor'` → `SensorSvg` (ignores icon)
  - `type === 'controller'` → `ControllerSvg` (ignores icon)
  - `type === 'machine'`, `icon === 'arm'` → `RobotArmSvg`
  - `type === 'machine'`, `icon === 'conveyor'` → `ConveyorSvg`
  - `type === 'machine'`, any other icon or none → `CncMachineSvg` (default for machines)
  - fallback → generic isometric box
- Status controls: border stroke color, glow ring color, pulse animation class
- Glow ring: `<ellipse>` under machine, `animation: alarm-pulse` for alarm nodes

### 5. Coordinate Projection

Node `data.x` and `data.y` (canvas pixel coords, arbitrary scale) → isometric screen coords:

```ts
// Step 1: normalize all nodes' coords within their workspace's bounding box
// (compute minX, maxX, minY, maxY from nodes[] per workspace)
const normX = (x - minX) / Math.max(maxX - minX, 1) // 0..1
const normY = (y - minY) / Math.max(maxY - minY, 1) // 0..1

// Step 2: scale to zone slot dimensions (each zone ~240×120 iso units)
const scaledX = normX * 200 + zoneOffsetX
const scaledY = normY * 100 + zoneOffsetY

// Step 3: isometric projection
const isoX = (scaledX - scaledY) * Math.cos(Math.PI / 6)
const isoY = (scaledX + scaledY) * Math.sin(Math.PI / 6) * 0.5

// Step 4: translate to SVG viewport center
const svgX = isoX + viewportCenterX
const svgY = isoY + viewportCenterY
```

Single-node edge case: if a workspace has only one node, place it at zone center (skip normalization).

### 6. `WorkspaceSidebar` — `app/(default)/dashboard/components/workspace-sidebar.tsx`

- List of workspaces from `workspacesAtom`
- Each row: icon box (workspace icon + color), name, device count, status dot (worst-status color)
- Active workspace: blue left border, blue-tinted bg
- Status filters below list: Alarm / Warning / Normal — filters which nodes show on map
- Clicking workspace: sets `selectedWorkspaceId`, map pans/highlights that zone

### 7. `NodeDetailPanel` — `app/(default)/dashboard/components/node-detail-panel.tsx`

- Shown when `selectedNodeId !== null`
- Fetches: AI models from `node.models` (already included in `getNodes()` response as `CanvasModel[]`)
- Sections: node name + type + status chip / AI Models list (name + run status) / Active Anomalies (from model status) / timestamps
- CTAs: "View Details →" → `/workspaces/{workspaceId}/canvas` / "Acknowledge Alarm" (future)
- Empty state when no node selected: faint "Select a device on the map"

### 8. `MachineLegend` — `app/(default)/dashboard/components/machine-legend.tsx`

- Fixed bottom bar: machine type icons + labels + status color key
- Static, no interaction

---

## Machine SVG Components

Five SVG components in `app/(default)/dashboard/components/machines/`:

| Component       | File              | Visual                                     |
| --------------- | ----------------- | ------------------------------------------ |
| `CncMachineSvg` | `cnc-machine.tsx` | Tall box + spindle head + tool bit         |
| `RobotArmSvg`   | `robot-arm.tsx`   | Base turntable + upper/lower arm + gripper |
| `SensorSvg`     | `sensor.tsx`      | Cylinder + antenna mast + signal rings     |
| `ConveyorSvg`   | `conveyor.tsx`    | Flat belt + rollers + items on belt        |
| `ControllerSvg` | `controller.tsx`  | Cabinet + HMI screen + buttons + LED strip |

All accept `status: 'normal' | 'warning' | 'alarm' | 'offline'` and `selected: boolean`.  
Status → stroke/glow color mapping follows `DESIGN_SYSTEM.md §5`:

| Status  | Border    | Glow ring           | Animation          |
| ------- | --------- | ------------------- | ------------------ |
| normal  | `#22c55e` | `bg-emerald-500/30` | none               |
| warning | `#f59e0b` | `bg-amber-500/30`   | gentle pulse 2s    |
| alarm   | `#ef4444` | `bg-red-500/30`     | `alarm-pulse` 1.6s |
| offline | `#71717a` | `bg-zinc-500/20`    | none               |

---

## Data Flow

```
useWorkspaces() ──► workspacesAtom (Jotai, persisted)
                       │
                       ▼
              parallel getNodes(wsId) for each workspace
                       │
                       ▼
              merge: nodes[] with workspaceId attached
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   WorkspaceSidebar  IsometricMap  NodeDetailPanel
   (status summary)  (positioned   (selected node
                      SVG nodes)    detail + models)
```

No new API endpoints needed. All data already available:

- `getAllWorkspaces()` → workspace list with `nodeCount`, `alarmCount`, `status`
- `getNodes(workspaceId)` → nodes with `data.{x,y,status,type,name}` + `models[]`

---

## Admin Dashboard

Old dashboard components (`kpi-cards`, `active-alert`, `workspace-list`, `stats`, `dashboard-header`) are already in `app/admin/dashboard/components/` — no changes needed there.

---

## Route & Navigation

| Change    | File                                           | What                                         |
| --------- | ---------------------------------------------- | -------------------------------------------- |
| New file  | `app/(default)/dashboard/page.tsx`             | New isometric dashboard                      |
| New file  | `app/(default)/dashboard/loading.tsx`          | Skeleton (required per CLAUDE.md)            |
| New file  | `app/(default)/dashboard/error.tsx`            | Error boundary (required)                    |
| New dir   | `app/(default)/dashboard/components/`          | All dashboard components live here           |
| New dir   | `app/(default)/dashboard/components/machines/` | 5 machine SVG components                     |
| No change | `components/sidebar.tsx`                       | Already links to `/dashboard`                |
| No change | `app/(default)/page.tsx`                       | Already redirects auth users to `/dashboard` |

---

## Verification

1. `pnpm --filter client dev` — navigate to `/dashboard` as authenticated user
2. Workspaces load in left sidebar with correct status dots
3. Nodes appear on isometric map at projected positions, correct machine SVG per type
4. Alarm nodes pulse red, warning nodes pulse amber
5. Clicking a node opens right panel with AI model list + anomaly details
6. Clicking workspace in sidebar highlights that zone on map
7. `pnpm format && pnpm build` — zero errors
