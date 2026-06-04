# Node Card Design

Design options explored for the MachineNode component in the React Flow canvas.
**Selected: Option C.**

---

## Option A — Compact Dark

Dark background (`#1a1d27`), 1px border, 10px radius. Status dot positioned at top-right corner of the icon box. Model status dots aligned bottom-right.

**Key traits:**

- Width: ~160px
- Icon box: 32×32px, dark fill (`#252836`)
- Status dot: 9px circle, bordered to match card background
- Model dots: 7px circles, `gap-1`, right-aligned
- 4 handle stubs on all sides

**Best for:** High node density — fits the most machines on screen without scrolling.

---

## Option B — Status Bar

Colored 3px top border indicates machine status at a glance. Divider line separates icon/name from the status label + model dots.

**Key traits:**

- Width: ~200px
- Status bar: 3px full-width strip, color = machine status
- Status text label (e.g. `NORMAL`, `WARNING`) in matching color, uppercase, 10px
- Icon box: 36×36px
- Divider: `border-top: 1px solid`
- Bottom row: status label left, model dots right

**Best for:** Operator dashboards where status legibility at a glance is the priority.

---

## Option C — Glassmorphism + Accent ✓ Selected

Semi-transparent glass card with a 2px left accent line whose color encodes the machine type.

**Key traits:**

- Width: ~180px
- Background: `rgba(255,255,255,0.04)`, `backdrop-filter: blur`
- Border: `1px solid rgba(255,255,255,0.1)`
- Inner top highlight: `inset 0 1px 0 rgba(255,255,255,0.06)`
- Left accent strip: absolute, 2px wide, inset 8px top/bottom, color by type:
  - `machine` → indigo `#6366f1`
  - `sensor` → orange `#f97316`
  - `controller` → green `#22c55e`
- Icon box: 34×34px, accent color at 20% opacity background + 40% opacity border
- Status dot: 8px, top-right of icon box, bordered
- Name: 13px, 600 weight, `#e2e5f0`
- Sub-label: "N models", 11px, `rgba(255,255,255,0.35)`
- Model dots: 8px circles, `gap-1`, right-aligned footer

**Status dot colors:**
| Status | Color |
|--------|-------|
| normal | `#22c55e` (green) |
| warning | `#f97316` (orange) |
| alarm | `#ef4444` (red) |
| offline | `#6b7280` (grey) |

**Model dot colors:**
| Status | Color |
|--------|-------|
| running | `#22c55e` |
| warning | `#f97316` |
| error | `#ef4444` |
| stopped | `#6b7280` |

**4 React Flow handles** (Top, Right, Bottom, Left):

- Hidden (`opacity-0`, `pointer-events-none`) in VIEW mode
- Visible in BUILD mode via `.build-mode` class on the ReactFlow wrapper

**Best for:** Premium dark-theme dashboards. The accent line gives instant machine-type identification without extra text.
