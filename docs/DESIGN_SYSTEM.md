# Design System

Design system reference for the SoftSensor client app (`apps/client`).

**Stack:** Tailwind v4 (CSS-first) · shadcn/ui (radix-nova style) · next-themes · Lucide React · Geist fonts

---

## Table of Contents

1. [Foundations](#1-foundations)
2. [Color Tokens](#2-color-tokens)
3. [Typography](#3-typography)
4. [Spacing & Radius](#4-spacing--radius)
5. [Status Color System](#5-status-color-system)
6. [Workspace Tokens](#6-workspace-tokens)
7. [Components](#7-components)
8. [Patterns](#8-patterns)
9. [Dark Mode](#9-dark-mode)
10. [Custom Utilities](#10-custom-utilities)
11. [Rules & Constraints](#11-rules--constraints)

---

## 1. Foundations

### Source of truth

| File                             | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `apps/client/app/globals.css`    | CSS variables, Tailwind theme, custom utilities |
| `apps/client/components.json`    | shadcn/ui configuration                         |
| `apps/client/store/workspace.ts` | Workspace color and icon tokens                 |
| `apps/client/components/ui/`     | Generated shadcn components — do not edit       |

### Core rules

- **Tailwind v4 CSS-first** — all tokens live as CSS variables. Never hardcode hex/rgb values in className or style.
- **CSS variables for colors** — use `bg-primary`, `text-destructive`, `border-border`, etc. Never `bg-[#3b82f6]`.
- **shadcn components are immutable** — add via `npx shadcn@latest add <component>`, never edit `components/ui/` files directly.
- **`cn()` for conditional classes** — imported from `@/lib/utils`.

---

## 2. Color Theory & Tokens

Before diving into CSS variables, it is crucial to understand the design principles driving our palette. All tokens are defined in `app/globals.css` under `:root` (light) and `.dark`, and registered in `@theme inline` for native Tailwind support.

### 2.1 The Purpose of Color

Applying strict color theory within the SoftSensor app provides three main benefits:

- **Impactful visual design:** Utilizing contrasting colors to grab the user’s attention, while striking a color balance for enduring visual appeal.
- **Improved UX:** Leveraging color harmony to support user workflows, making it easier to scan content and intuitively navigate the product’s UI.
- **Better brand expression:** Showcasing our brand personality, core messaging, and mood through a calculated, deliberate palette.

### 2.2 The Color Wheel Foundations

Our semantic system and status colors respect the fundamental relationships defined by the traditional color wheel:

- **Primary colors (RYB):** Red, yellow, and blue. When combined, these serve as the base for all other colors in the UI.
- **Secondary colors:** Orange, green, and violet. Formed by mixing two primary colors (e.g., red + yellow = orange).
- **Tertiary colors:** Red-orange, yellow-orange, yellow-green, blue-green, blue-violet, and red-violet. The result of mixing a primary color with a secondary color.

### 2.3 Semantic Tokens

| Token                    | Light                      | Dark                | Usage                         |
| ------------------------ | -------------------------- | ------------------- | ----------------------------- |
| `--background`           | Near-white                 | Very dark           | Page background               |
| `--foreground`           | Dark                       | Near-white          | Body text                     |
| `--card`                 | Pure white                 | Dark charcoal       | Card surfaces                 |
| `--card-foreground`      | Dark                       | Near-white          | Text on cards                 |
| `--popover`              | Pure white                 | Dark charcoal       | Popover/dropdown surfaces     |
| `--primary`              | Blue (oklch 0.55 0.18 250) | Brighter blue (0.6) | CTAs, active states, links    |
| `--primary-foreground`   | White                      | White               | Text on primary bg            |
| `--secondary`            | Light gray                 | Dark gray           | Secondary buttons, chips      |
| `--secondary-foreground` | Dark                       | Light               | Text on secondary             |
| `--muted`                | Very light gray            | Dark gray           | Subtle backgrounds, disabled  |
| `--muted-foreground`     | Medium gray                | Gray                | Placeholder, secondary labels |
| `--accent`               | Subtle gray                | Dark                | Hover highlights              |
| `--accent-foreground`    | Dark                       | Light               | Text on accent                |
| `--destructive`          | Red-orange                 | Darker red          | Errors, delete actions        |
| `--border`               | Light gray                 | Dark gray           | Borders, dividers             |
| `--input`                | Light gray                 | Dark gray           | Input backgrounds             |
| `--ring`                 | Matches primary            | Matches primary     | Focus rings                   |

### 2.4 Chart Tokens

`--chart-1` through `--chart-5` — blue-to-purple spectrum. Used for data visualizations only.

### 2.5 Sidebar Tokens

`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` — mirrors semantic tokens but scoped specifically to the sidebar surface to maintain visual hierarchy.

### 2.6 Usage in Code

```tsx
// Correct — CSS variable-backed class (maintains color harmony & dark mode)
<div className="bg-card text-card-foreground border-border" />

// Wrong — hardcoded color (breaks theory and theme support)
<div className="bg-[#0f1115]" />
```

---

## 3. Typography

### Fonts

| Variable            | Font       | Format        | Usage                       |
| ------------------- | ---------- | ------------- | --------------------------- |
| `--font-geist-sans` | Geist      | Variable woff | `font-sans` — all body text |
| `--font-geist-mono` | Geist Mono | Variable woff | `font-mono` — code, numbers |

Both loaded locally from `app/fonts/`. Applied via `className` on the root `<html>` element in `app/layout.tsx`.

### Scale (Tailwind defaults, used in project)

| Class       | Size | Usage                                      |
| ----------- | ---- | ------------------------------------------ |
| `text-xs`   | 12px | Labels, badges, timestamps, secondary info |
| `text-sm`   | 14px | Body text, table cells, form fields        |
| `text-base` | 16px | Default body, card titles                  |
| `text-lg`   | 18px | Section headings                           |
| `text-2xl`  | 24px | KPI numbers, stat card values              |
| `text-3xl`  | 30px | Page titles (`h1`)                         |

### Font weight conventions

| Weight | Class           | Usage                         |
| ------ | --------------- | ----------------------------- |
| 400    | `font-normal`   | Body text                     |
| 500    | `font-medium`   | Table headers, form labels    |
| 600    | `font-semibold` | Section headings, card titles |
| 700    | `font-bold`     | Page titles, KPI numbers      |

---

## 4. Spacing & Radius

### Border radius

| Token         | Value | Class        |
| ------------- | ----- | ------------ |
| `--radius-sm` | 4px   | `rounded-sm` |
| `--radius-md` | 6px   | `rounded-md` |
| `--radius-lg` | 8px   | `rounded-lg` |
| `--radius-xl` | 12px  | `rounded-xl` |

Base `--radius: 0.5rem` (8px). Derived values via `calc()`.

### Page layout

```
p-6 md:p-8          — page padding
max-w-7xl mx-auto   — content max-width
space-y-6 / space-y-8 — section vertical rhythm
gap-4               — grid/flex gap standard
```

### Grid patterns

```
grid grid-cols-2 md:grid-cols-4 gap-4    — KPI/stat cards
grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4  — workspace cards
```

---

## 5. Status Color System

Established pattern for node/model/alert status across the app. Use these combinations consistently — do not invent new status colors.

### Node status

| Status    | Dot              | Text               | Icon                |
| --------- | ---------------- | ------------------ | ------------------- |
| `normal`  | `bg-emerald-500` | `text-emerald-500` | CheckCircle         |
| `warning` | `bg-amber-500`   | `text-amber-500`   | AlertTriangle       |
| `alarm`   | `bg-red-500`     | `text-red-500`     | Siren / AlertCircle |
| `offline` | `bg-zinc-500`    | `text-zinc-400`    | Power               |

### Model run status (badge)

| Status         | Background          | Text               | Icon       |
| -------------- | ------------------- | ------------------ | ---------- |
| `running`      | `bg-emerald-500/15` | `text-emerald-500` | Play       |
| `error`        | `bg-red-500/15`     | `text-red-500`     | XCircle    |
| `stopped`      | `bg-zinc-500/15`    | `text-zinc-400`    | StopCircle |
| `initializing` | `bg-blue-500/15`    | `text-blue-400`    | RefreshCw  |

### Model deployment/production status (badge)

| Status    | Background          | Text               | Icon          |
| --------- | ------------------- | ------------------ | ------------- |
| `running` | `bg-emerald-500/15` | `text-emerald-500` | Activity      |
| `warning` | `bg-amber-500/15`   | `text-amber-500`   | AlertTriangle |
| `alert`   | `bg-red-500/15`     | `text-red-500`     | AlertCircle   |
| `offline` | `bg-zinc-500/15`    | `text-zinc-400`    | Power         |

### Status badge pattern

```tsx
<Badge
  variant="outline"
  className={`gap-1 border-0 text-xs font-medium ${color}`}
>
  {icon}
  {status}
</Badge>
```

### Card ring highlight (active filter)

```tsx
className={`... ${filter === value ? 'ring-2 ring-emerald-500' : ''}`}
```

---

## 6. Workspace Tokens

Defined in `apps/client/store/workspace.ts`. Used in workspace settings and the workspace-list card.

### Colors

```ts
export const workspaceColors = [
  { id: 'blue', bg: 'bg-blue-500' },
  { id: 'violet', bg: 'bg-violet-500' },
  { id: 'emerald', bg: 'bg-emerald-500' },
  { id: 'amber', bg: 'bg-amber-500' },
  { id: 'rose', bg: 'bg-rose-500' },
  { id: 'cyan', bg: 'bg-cyan-500' },
]
```

**Lookup pattern** (use `.find()`, never bracket indexing on this array):

```ts
const accentClass =
  workspaceColors.find(c => c.id === workspace.color)?.bg ?? 'bg-blue-500'
```

### Icons

```ts
export const workspaceIcons = [
  { id: 'building', icon: Building2 },
  { id: 'box', icon: Box },
  { id: 'cpu', icon: Cpu },
  { id: 'gauge', icon: Gauge },
  { id: 'thermometer', icon: Thermometer },
  { id: 'activity', icon: Activity },
  { id: 'globe', icon: Globe },
  { id: 'shield', icon: Shield },
]
```

### Workspace card accent

The `.workspace-accent` utility applies a 3px colored top border using a CSS variable:

```css
/* globals.css */
@layer utilities {
  .workspace-accent {
    border-top: 3px solid var(--workspace-color, transparent);
  }
}
```

```tsx
<Card
  className="workspace-accent border-border bg-card"
  style={workspace.color ? ({ '--workspace-color': workspace.color } as React.CSSProperties) : undefined}
>
```

---

## 7. Components

All from shadcn/ui (`components/ui/`). Do not edit generated files.

### Available components

| Component    | File                | Notes                              |
| ------------ | ------------------- | ---------------------------------- |
| Accordion    | `accordion.tsx`     | Collapsible sections               |
| Alert        | `alert.tsx`         | Variants: `default`, `destructive` |
| AlertDialog  | `alert-dialog.tsx`  | Confirmation modals                |
| Avatar       | `avatar.tsx`        | User/workspace avatars             |
| Badge        | `badge.tsx`         | Status labels, tags                |
| Breadcrumb   | `breadcrumb.tsx`    | Navigation trail                   |
| Button       | `button.tsx`        | See variants below                 |
| Calendar     | `calendar.tsx`      | Date picking                       |
| Card         | `card.tsx`          | Primary content container          |
| Chart        | `chart.tsx`         | Recharts wrapper                   |
| Checkbox     | `checkbox.tsx`      | Boolean input                      |
| Command      | `command.tsx`       | Command palette / search           |
| Dialog       | `dialog.tsx`        | Modal dialogs                      |
| DropdownMenu | `dropdown-menu.tsx` | Contextual menus                   |
| Input        | `input.tsx`         | Text input                         |
| Label        | `label.tsx`         | Form labels                        |
| Popover      | `popover.tsx`       | Floating panels                    |
| Progress     | `progress.tsx`      | Progress bar                       |
| RadioGroup   | `radio-group.tsx`   | Radio inputs                       |
| ScrollArea   | `scroll-area.tsx`   | Custom scrollbars                  |
| Select       | `select.tsx`        | Dropdown select                    |
| Separator    | `separator.tsx`     | Dividers                           |
| Sheet        | `sheet.tsx`         | Side panel / drawer                |
| Sidebar      | `sidebar.tsx`       | App sidebar                        |
| Skeleton     | `skeleton.tsx`      | Loading placeholder                |
| Slider       | `slider.tsx`        | Range input                        |
| Sonner       | `sonner.tsx`        | Toast notifications                |
| Switch       | `switch.tsx`        | Toggle                             |
| Table        | `table.tsx`         | Data tables                        |
| Tabs         | `tabs.tsx`          | Tab navigation                     |
| Textarea     | `textarea.tsx`      | Multi-line input                   |
| Tooltip      | `tooltip.tsx`       | Hover hints                        |

### Button variants

| Variant       | When to use                                |
| ------------- | ------------------------------------------ |
| `default`     | Primary CTA — solid primary blue           |
| `outline`     | Secondary action — border, transparent bg  |
| `ghost`       | Tertiary / nav items — no border, hover bg |
| `secondary`   | Alternative CTA — muted bg                 |
| `destructive` | Delete / irreversible action               |
| `link`        | Inline text link                           |

**Sizes:** `default` (h-9) · `sm` (h-8) · `lg` (h-10) · `icon` (square, h-9) · `icon-sm` (h-8) · `icon-lg` (h-10)

### Tab active state

Active tabs use the primary blue pattern:

```tsx
<TabsTrigger
  className="cursor-pointer gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
>
```

### Toast (Sonner)

Import from `@/components/ui/sonner`. Use `toast.success()`, `toast.error()`, `toast.loading()`. Sonner is registered once in `app/layout.tsx`.

```tsx
import { toast } from 'sonner'
toast.success('Workspace created')
toast.error('Something went wrong')
```

---

## 8. Patterns

### Page layout

```tsx
<div className="flex flex-1 overflow-auto bg-background p-6 md:p-8">
  <div className="mx-auto w-full max-w-7xl space-y-6">
    <Breadcrumb>...</Breadcrumb>
    {/* header */}
    {/* content sections */}
  </div>
</div>
```

### Stat card (KPI)

```tsx
<Card className="cursor-pointer border-border bg-card transition-all hover:border-emerald-500/50">
  <CardContent className="p-4">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-muted-foreground">Label</p>
        <p className="text-2xl font-bold text-emerald-500">{count}</p>
      </div>
      <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </CardContent>
</Card>
```

### Data table

```tsx
<Card className="border-border bg-card">
  <CardHeader className="pb-3">
    <CardTitle className="text-base font-medium">Title</CardTitle>
  </CardHeader>
  <CardContent className="p-0">
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Col
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/50 transition-colors hover:bg-muted/20">
            <td className="px-4 py-3">Value</td>
          </tr>
        </tbody>
      </table>
    </div>
  </CardContent>
</Card>
```

### Empty state

```tsx
<div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
  <Icon className="h-10 w-10 opacity-30" />
  <p className="text-base font-medium">Nothing here</p>
  <p className="text-sm">Helpful next step message.</p>
</div>
```

### Section heading with action

```tsx
<div className="flex items-center justify-between">
  <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
    <Icon className="h-5 w-5 text-primary" />
    Section Title
  </h2>
  <Button variant="ghost" size="sm" className="gap-1 text-primary">
    Action
    <ChevronRight className="h-4 w-4" />
  </Button>
</div>
```

---

## 9. Dark Mode

Implemented via `next-themes` (`ThemeProvider` at `components/providers/theme-provider.tsx`).

- Mode toggled by adding/removing `.dark` class on `<html>`
- CSS uses `@custom-variant dark (&:is(.dark *))` — no Tailwind `dark:` prefix needed for base tokens (they flip automatically via CSS variable redefinition)
- Use `dark:` Tailwind prefix only for one-off overrides not covered by the token system

```tsx
// All tokens flip automatically — no dark: prefix needed
<div className="bg-card text-card-foreground" />

// Use dark: prefix only for non-token overrides
<div className="opacity-60 dark:opacity-40" />
```

---

## 10. Custom Utilities

Defined in `app/globals.css` under `@layer utilities`.

### `.workspace-accent`

Applies a 3px top border in the workspace's assigned color via CSS custom property.

```css
.workspace-accent {
  border-top: 3px solid var(--workspace-color, transparent);
}
```

Usage: set `--workspace-color` via inline style on the element, apply `.workspace-accent` class.
Fallback to `transparent` when no color is set.

---

## 12. Laws of UX Conventions

Applied when designing navigation, status display, and information hierarchy.

| Law                 | Enforcement                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Von Restorff**    | Errors/alerts use `text-destructive` + `TriangleAlert` icon + `animate-pulse` when active — must visually pop from surrounding nav items |
| **Serial Position** | High-urgency items (Alerts) placed 2nd in sidebar nav — early scan position                                                              |
| **Miller's Law**    | Global sidebar nav capped at 5 items — never add more                                                                                    |
| **Hick's Law**      | Context-specific sub-items (workspace Canvas/Models/Alerts) hidden until workspace is selected                                           |
| **Fitts's Law**     | Frequently accessed workspace actions reachable in ≤1 click from sidebar context zone                                                    |
| **Common Region**   | Workspace sub-items grouped in a visually bounded box, not inline with global nav                                                        |

### Active Context Zone (workspace sub-navigation)

Bordered card that appears below the workspace list when a workspace is active.

```tsx
<div className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-0.5">
  {/* header: workspace icon + name */}
  {/* sub-items: Canvas · Models · Alerts */}
</div>
```

### Workspace Status Dot (sidebar compact row)

Rightmost element in each workspace row. Color = worst node status across workspace.

```tsx
<span
  className={cn('h-2 w-2 shrink-0 rounded-full', workspaceStatusDot(ws.status))}
/>
```

`workspaceStatusDot(status)` helper returns: `bg-red-500` (alarm) · `bg-amber-500` (warning) · `bg-zinc-500` (offline) · `bg-emerald-500` (normal).

Collapsed sidebar: overlay dot on workspace icon via `absolute -top-0.5 -right-0.5 ring-1 ring-sidebar`.

### Alert Badge (global nav + context zone)

```tsx
{
  /* nav item badge */
}
;<span className="ml-auto rounded-full bg-destructive text-destructive-foreground px-2 py-0.5 text-xs">
  {count}
</span>

{
  /* icon when alerts active */
}
;<TriangleAlert className={cn('h-4 w-4', count > 0 && 'animate-pulse')} />
```

Badge count = sum of `alarmCount` per workspace from `useAlertCount()` hook. Must match `/alerts` page row count.

---

## 11. Rules & Constraints

| Rule                            | Detail                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| No hardcoded colors             | Use CSS variable tokens only. `bg-[#hex]` is forbidden.                                                                        |
| No `any` or `@ts-ignore`        | Zero tolerance in TypeScript.                                                                                                  |
| No editing `components/ui/`     | Add via `npx shadcn@latest add`.                                                                                               |
| Tailwind v4 display conflict    | Never combine `lg:flex` + `lg:hidden` on one element — `lg:flex` wins. Use conditional rendering instead.                      |
| `cn()` for conditionals         | Import from `@/lib/utils`. Don't use template literals for conditional classes.                                                |
| Inline style for dynamic colors | When color value is runtime-dynamic, set a CSS variable via `style` and read it in a CSS class.                                |
| Array lookup with `.find()`     | When querying `workspaceColors` or `workspaceIcons` by `id`, always use `.find(c => c.id === value)` — never bracket indexing. |
| Status color consistency        | Use the established status color table in §5. Don't create new status color mappings.                                          |
| Server Components by default    | Only add `"use client"` when hooks or event listeners are required. Never on layouts.                                          |
