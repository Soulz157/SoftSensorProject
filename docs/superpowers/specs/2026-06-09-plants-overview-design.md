# Plants Overview Page — Design Spec

**Date:** 2026-06-09  
**Status:** Approved

---

## Context

The app currently has no high-level view of all workspaces together. Users must navigate to `/workspaces` and scan a card grid to get an overview of system-wide health. This spec introduces a **Plants Overview** page — an isometric 2.5D map where every workspace (plant / sub-company) is rendered as a single tower. It replaces the Dashboard nav slot and becomes the primary entry point into the app.

---

## Design Decisions

| Decision                 | Choice                                              | Reason                                                                             |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tower vs zone vs cluster | Single tower per workspace                          | Iconic, scalable, status readable at a glance                                      |
| Page location            | New `/plants` route, replaces Dashboard in sidebar  | Dedicated purpose; Dashboard slot freed since plants map IS the top-level overview |
| Click interaction        | Click → right detail panel; double-click → navigate | Preview before commit; consistent with existing `NodeDetailPanel` pattern          |
| Navigate destination     | `View Workspace →` → `/workspaces/[id]`             | Goes to existing workspace detail page                                             |
| "Nodes" label            | Renamed to **Equipments**                           | Domain language used by the user                                                   |

---

## Route & Navigation

- **Route:** `/plants` (new)
- **Sidebar slot:** Replaces `Dashboard` (`/dashboard`) — keeps Miller's Law 5-item cap
- **Sidebar icon:** `Factory` or `Home` (Lucide)
- **Active workspace context zone** in sidebar updates when a tower is selected

---

## Page Layout

```
┌─────────────┬────────────────────────────────┬──────────────┐
│  Sidebar    │  Isometric Canvas              │ Detail Panel │
│  (220px)    │  (flex-1)                      │  (300px)     │
│             │                                │              │
│  Plants ●   │  [HUD overlay top-left]        │  (empty when │
│  Alerts     │                                │   nothing    │
│  Models     │  [6 workspace towers]          │   selected)  │
│  Analytics  │                                │              │
│  Settings   │  [terrain lines between]       │  (plant card │
│             │                                │   when tower │
│  [Active WS │  [status labels below towers]  │   clicked)   │
│   context]  │                                │              │
└─────────────┴────────────────────────────────┴──────────────┘
```

**Top bar:** Page title "Plants Overview" + system-wide status pills (N normal · N warning · N alarm · N plants).

---

## Isometric Scene

### Tower rendering

Each workspace = one isometric building rendered in SVG:

- **Floor platform** (diamond) — workspace `color` token from `workspaceColors` (blue/violet/emerald/amber/rose/cyan)
- **Tower body** (3-face isometric box) — taller when more equipments (scale: `height = 40 + nodeCount * 2`, capped at max)
- **Tower roof** (top diamond) — filled with workspace accent color
- **Antenna** — thin vertical line + dot above roof
- **Status glow** — ellipse at base, color = worst node status across workspace
- **Label tag** below floor — workspace name + status text

### Status visual mapping (matches §5 Design System)

| Status    | Glow color | Roof color      | Beacon                   |
| --------- | ---------- | --------------- | ------------------------ |
| `normal`  | `#22c55e`  | workspace color | small dot                |
| `warning` | `#f59e0b`  | `#f59e0b`       | pulsing circle           |
| `alarm`   | `#ef4444`  | `#ef4444`       | pulsing concentric rings |
| `offline` | `#71717a`  | `#52525b`       | dashed antenna           |

### Layout algorithm

Reuse `calculateIsometricLayout()` from `lib/isomatric.ts` — pass workspaces as zones with `zoneNodeKey='workspaceId'`. Each zone renders only the floor + tower (no individual `MachineNode` SVGs).

### HUD overlay (top-left)

Absolute-positioned card:

- Online plants count (e.g. `6/6`)
- Total alarms (red)
- Total warnings (amber)

### Interaction

- **Click tower** → select (dashed selection ring) + load detail panel
- **Double-click tower** → navigate to `/workspaces/[id]`
- **Drag** → pan canvas (existing drag pattern from `IsometricMap`)
- **Hover** → tower lifts 2px (CSS transition)

---

## Detail Panel (right, 300px)

Shown when a tower is selected. Hidden / empty state when nothing selected.

### Header

Workspace icon (from `workspaceIcons`) + name + "Sub-company workspace" subtitle.

### Status badge

Full-width badge — color matches status. Text: `"Alarm — N equipments critical"` or `"Warning"` or `"Normal"`.

### Stats grid (2×2)

| Cell       | Value              | Color             |
| ---------- | ------------------ | ----------------- |
| EQUIPMENTS | `nodeCount`        | blue              |
| MODELS     | `modelsCount`      | blue              |
| ALARMS     | `alarmCount`       | red (0 = green)   |
| WARNINGS   | warning node count | amber (0 = muted) |

### Alarm list (shown when `alarmCount > 0`)

Section header: `ALARMS (N)` in red.

Each alarm item shows:

- Equipment icon (type-based emoji/SVG)
- **Equipment name** (`node.data.name`)
- Type + zone path (`node.data.type · WorkspacePlan.name`)
- **Status label** — `"Status: alarm"` (backend stores only `status`, not a reason string — no placeholder, this is the full data available today)
- Time since last update (`node.updatedAt` formatted as relative time)

### Warning list (shown when warnings > 0)

Same structure as alarm list, amber color scheme.

### Actions

- `View All Alerts →` — navigates to `/alerts` (shown only when alarms > 0)
- `View Workspace →` — navigates to `/workspaces/[id]` (primary CTA, always shown)
- `Open Canvas` — navigates to `/workspaces/[id]/canvas` (ghost button)

---

## Data Flow

```
workspacesAtom (Jotai)        → workspace list (name, color, icon, nodeCount, alarmCount, status)
getNodes(workspaceId)         → per-workspace nodes for alarm/warning breakdown
Promise.all(workspaces.map(…)) → parallel fetch, same pattern as use-dashboard-data.ts
```

New hook: `hooks/use-plants-data.ts`

- Reads `workspacesAtom`
- Calls `getNodes()` per workspace in parallel (only on first load or manual refetch)
- Returns `{ workspaces, nodesByWorkspace, loading }`

Node status aggregation — reuse `deriveNodeSummary()` logic (already on backend) or replicate the priority logic client-side: alarm(3) > offline(2) > warning(1) > normal(0).

---

## Files to Create / Modify

| File                                                                 | Action                                        |
| -------------------------------------------------------------------- | --------------------------------------------- |
| `apps/client/app/(default)/plants/page.tsx`                          | New — main page (client component, uses hook) |
| `apps/client/app/(default)/plants/loading.tsx`                       | New — skeleton                                |
| `apps/client/app/(default)/plants/error.tsx`                         | New — error boundary                          |
| `apps/client/app/(default)/plants/components/plant-tower.tsx`        | New — SVG tower component                     |
| `apps/client/app/(default)/plants/components/plant-detail-panel.tsx` | New — right panel                             |
| `apps/client/app/(default)/plants/components/plants-hud.tsx`         | New — HUD overlay                             |
| `apps/client/hooks/use-plants-data.ts`                               | New — data hook                               |
| `apps/client/components/sidebar.tsx`                                 | Modify — swap Dashboard → Plants nav item     |

---

## Reused Patterns & Utilities

- `lib/isomatric.ts` — `calculateIsometricLayout()`, `ZoneItem`, `GRID_SPACING`
- `lib/utils.ts` — `cn()`
- `store/workspace.ts` — `workspacesAtom`, `workspaceColors`, `workspaceIcons`
- `services/canvas.ts` — `getNodes()`, `CanvasNode` type
- `components/ui/` — `Badge`, `Button`, `Skeleton`, `Separator`
- Status color pattern from Design System §5 (no new status colors)
- Drag-to-pan logic from `isometric-map.tsx`
- `NodeDetailPanel` structure from `dashboard/components/node-detail-panel.tsx` as reference

---

## Verification

1. `pnpm --filter client dev` → open `http://localhost:3000/plants`
2. Sidebar shows **Plants** in position 1, no Dashboard entry
3. 6 workspace towers visible, each with correct status glow
4. Click tower → detail panel slides in with correct workspace data
5. Alarm panel shows equipment list when workspace has alarms
6. "View Workspace →" navigates to `/workspaces/[id]`
7. "Open Canvas" navigates to `/workspaces/[id]/canvas`
8. `pnpm build` passes with no type errors
