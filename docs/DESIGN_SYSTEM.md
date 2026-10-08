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
12. [Laws of UX Conventions](#12-laws-of-ux-conventions)
13. [Brand & Public Surfaces](#13-brand--public-surfaces)
14. [All Workspaces list](#14-all-workspaces-list)
15. [Admin dashboard](#15-admin-dashboard)

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

Import from `@/components/ui/sonner`. Use `toast.success()`, `toast.error()`, `toast.loading()`. Sonner is registered once in `components/providers/session-provider.tsx` (not `app/layout.tsx`).

Width is decided by CONTENT, not by toast type (`app/globals.css`): the toaster is capped at `min(560px, calc(100vw - 2rem))` and each toast is `fit-content` between a `--width` floor (380px, set in `sonner.tsx`) and that cap. Do not add per-type width rules — an error is not wide because it is an error, it is wide because its text is long. A multi-line message may be passed as the title; `[data-title]` is `white-space: pre-line`.

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

### Date-time range over data

Any start/end window picked **inside a dataset's real time span** (validation holdouts, retrain validation windows) uses `CalendarDateTimePicker` (`components/calendar-date-time-picker.tsx`): an outline trigger showing `yyyy-MM-dd HH:mm`, opening a popover with the shadcn `Calendar` (month/year dropdowns), a `Time` input and a **Done** button.

```tsx
<CalendarDateTimePicker
  id="holdout-from" // pairs with a visible <Label htmlFor>
  label="Validation holdout start" // accessible name
  value={from} // 'yyyy-MM-ddTHH:mm' or ''
  onChange={setFrom}
  dataBounds={{ min: dataStart, max: dataEnd }} // how far the calendar pages
  allowed={{ min: floor, max: to || dataEnd }} // what can be picked
  defaultTime="00:00" // '23:59' for an end
  invalid={error !== null}
/>
```

Rules:

- **Never a native `<input type="date">` / `datetime-local` for these.** The native picker hides every month outside `min`/`max`, so a range clamped to part of the data looks like a picker that won't scroll. The calendar pages across the whole of `dataBounds` and greys out only the days outside `allowed`.
- **Always carry the time.** Servers check a window against the data's real first/last reading, so a whole-day window (00:00–23:59:59) is refused when the data starts or ends mid-day. Picking a day applies `defaultTime` (`00:00` start, `23:59` end) then clamps it into `allowed`, so two picked days are already a valid window.
- **Narrow each end by the other**: start's `allowed.max` is the chosen end, end's `allowed.min` is the chosen start.
- **Values are naive `yyyy-MM-ddTHH:mm` stamps**, compared as strings and never round-tripped through `Date` (helpers in `lib/date-stamp.ts`). Convert to ISO only at the API edge.
- **State both ranges when they differ**: `Data covers A to B.` plus `Pickable: C to D.` in `text-[11px] text-muted-foreground`; an impossible range (`min > max`) gets one `text-destructive` sentence saying why and what to do, and the triggers disable.
- The picker's `min`/`max` are guidance, not validation — the caller's own check (and the server) remain the guard, shown inline in `text-[11px] text-destructive`.

The older five-select `DateTimePicker` (`components/date-time-picker.tsx`) remains for free-form fetch ranges that are not bounded by an existing dataset.

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

| Rule                                      | Detail                                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No hardcoded colors                       | Use CSS variable tokens only. `bg-[#hex]` is forbidden.                                                                                                                                        |
| No `any` or `@ts-ignore`                  | Zero tolerance in TypeScript.                                                                                                                                                                  |
| No editing `components/ui/`               | Add via `npx shadcn@latest add`.                                                                                                                                                               |
| Tailwind v4 display conflict              | Never combine `lg:flex` + `lg:hidden` on one element — `lg:flex` wins. Use conditional rendering instead.                                                                                      |
| `cn()` for conditionals                   | Import from `@/lib/utils`. Don't use template literals for conditional classes.                                                                                                                |
| Inline style for dynamic colors           | When color value is runtime-dynamic, set a CSS variable via `style` and read it in a CSS class.                                                                                                |
| Array lookup with `.find()`               | When querying `workspaceColors` or `workspaceIcons` by `id`, always use `.find(c => c.id === value)` — never bracket indexing.                                                                 |
| Status color consistency                  | Use the established status color table in §5. Don't create new status color mappings.                                                                                                          |
| Server Components by default              | Only add `"use client"` when hooks or event listeners are required. Never on layouts.                                                                                                          |
| No real plant identifiers on public pages | Signed-out pages (landing, auth) show illustrative data only — mock tag names (`TEMP-01`, `FLOW-02` …), never real PI tags or model names. See §13.4.                                          |
| Theme-dependent UI after mount            | Anything that reads the theme (`useTheme`) renders its selected state only after mount (`useSyncExternalStore` guard) — the server cannot know the theme, and a mismatch is a hydration error. |

---

## 13. Brand & Public Surfaces

Added 2026-10-07 with the auth and landing redesign. Covers the logo and the pages a signed-out visitor sees. Everything here uses the tokens in §2 — no new colours.

### 13.1 Logo — `BrandMark`

`components/brand/brand-mark.tsx`. A calm predicted curve with a lab sample (diamond) on it — what the product does, drawn once. The curve follows `currentColor`; the diamond is `--primary`, cut out of the line by a thin ring in the surface colour so the two never merge.

| Prop       | Use                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant`  | `line` (default, used everywhere), `framed`, `tile` (on `--primary`)                                                                           |
| `wordmark` | `true` adds "SoftSensor" (600, tracking-tight). Sidebars pass `false` and render their own label so collapse works.                            |
| `surface`  | Colour behind the mark, for the diamond's ring: `var(--card)` default, `var(--sidebar)` in sidebars, `var(--background)` on the landing header |
| `size`     | px, default 28                                                                                                                                 |

Used in: auth shell, landing header, app sidebar and admin sidebar. Don't recolour it, don't put it on a coloured tile outside the `tile` variant, and don't replace it with a Lucide icon.

### 13.2 Signal trace — `SignalTrace`

`components/auth/signal-trace.tsx` + pure maths in `lib/signal-trace.ts` (deterministic, tested). The one moving element on public pages: a soft-sensor prediction drifting left, with lab samples as diamonds (the same mark as the Actual vs Predict chart).

| Variant | Where                       | Behaviour                                                                                                                              |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `chart` | Auth trend panel            | Gridlines; hover scrubs a crosshair and reads `value · time` in mono                                                                   |
| `line`  | Landing, auth `card` layout | No grid; bends gently toward the pointer. `readout` + `model` add a fit panel; `labHover` shows lab vs predicted vs error on a diamond |

- Colours: line `--primary`, diamonds `--foreground`, grid `--border`. Never status colours.
- Draws by mutating SVG attributes in a `requestAnimationFrame` loop — no React re-render per frame.
- `prefers-reduced-motion`: drawn once, no drift, no pull. Hover readouts still work (they answer the user).

### 13.3 Auth shell and form parts

`components/auth/auth-shell.tsx` wraps every auth page (login, register, reset request, set new password, change password).

- `AUTH_LAYOUT` (one constant) picks the layout for every page: `split` (current — trend panel left, form right, strip on phones) or `card` (centred card, line through its top border).
- The logo links home; the theme switcher sits top-right (§13.6).
- Title is Display (`clamp(1.5rem, 2.5vw, 2rem)`, 600, −0.02em), once per page.

| Part               | File                                    | Rule                                                                                                                                                                                         |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FormField`        | `components/auth/form-field.tsx`        | Label (`htmlFor`) + control + one-sentence error (`text-xs text-destructive`, `id={id}-error`)                                                                                               |
| `PasswordField`    | `components/auth/password-field.tsx`    | Show/hide toggle with `aria-pressed` and an accessible name                                                                                                                                  |
| `PasswordStrength` | `components/auth/password-strength.tsx` | One segment per rule, `bg-muted` → `bg-primary` + text checklist. **No amber or green** — those are plant status. Rules live in `lib/password-rules.ts` and are shared with the zod schemas. |
| `TextLink`         | `components/auth/text-link.tsx`         | Inline footer link, visible focus ring                                                                                                                                                       |

Copy: English, sentence case, buttons name the action ("Sign in", "Send reset link", "Update password"). Errors say what's wrong and how to fix it ("Use at least 8 characters."), never apologise.

### 13.4 Landing page (`/`, signed out)

- **Full screen:** `AppLayout` renders only `children` when `pathname === '/'` and the session is `unauthenticated` — no sidebar, search or system-health badge for guests. Signed-in users are unchanged.
- `components/landing/landing-hero.tsx`, `layout="tags"` (current): copy left; input tags → model → prediction line right (`components/landing/tag-feed.tsx`). `layout="line"` is the alternative (line across the lower third). Both are kept in the preview at `/design-preview/landing`.
- **Hero type exception:** the landing headline may use `clamp(2.25rem, 4.5vw, 3.5rem)` at weight 600 (still never 700). DESIGN.md's 2rem Display cap applies inside the app; this page is outside it.
- **Demo data rule:** every number and name on the landing comes from `lib/landing-demo.ts` and is illustrative — mock tags `TEMP-01`, `FLOW-02`, `PRESS-03`, `RATIO-04`, target `RVP-DEMO`. Never a real PI tag or model name; `components/landing/__tests__/landing-hero.test.tsx` fails on a `XX000.PV`-style tag.
- **Drift on the landing** reuses the in-app Drift badge exactly (`MONITORING_STATUS_CLASS` / `MONITORING_STATUS_LABEL` from `lib/drift-status-style.ts`) with the backend's PSI cutoffs (WARN ≥ 0.10, CRITICAL ≥ 0.25). This is the existing monitoring-drift carve-out from the status-colour reservation, not a new use of status colour.

### 13.5 Aura — `CursorAura` (documented exception)

`components/landing/cursor-aura.tsx`. A soft light behind the landing that trails the pointer and rests beside the model diagram. **This is a deliberate, user-requested exception to DESIGN.md's no-glow rule**, and it is only allowed under these limits:

- `--primary` only, mixed into transparency (`color-mix(in oklch, var(--primary) 16%, transparent)`); `opacity-70` light / `opacity-100` dark.
- A plain `radial-gradient` — never `filter: blur` or `backdrop-filter`.
- Signed-out pages only (currently the landing). Never inside the app shell.
- Reduced motion: holds still at its rest point. Touch input: ignored (rests).
- Switchable: `LandingHero aura={false}`.

### 13.6 Theme switcher — `ThemeSwitcher`

`components/landing/theme-switcher.tsx`. Light / Dark / Match system — the same three choices, icons (Sun / Moon / Monitor) and order as Settings → Appearance. A `radiogroup` of icon buttons with accessible names.

- On the landing header and top-right of every auth page. Inside the app, theme stays in Settings → Appearance.
- Shows no selection until mounted (rule in §11) — keeps hydration clean.

### 13.7 Motion on public pages

- One continuous motion per page (the signal trace; the aura only follows the user). No entrance animations, no hover lift.
- Every animation has a `prefers-reduced-motion` path, and loops stop when there's nothing to move.

---

## 14. All Workspaces list

Added 2026-10-07. `/workspaces` (`app/(default)/workspaces/`). The instrument-list direction was chosen over cards.

- **Header:** `WorkspacesHeader` — Display title (sentence case, 600), a one-line summary in mono (`5 workspaces · 2 need attention · 46 models`) instead of KPI cards, and "Create workspace".
- **Toolbar:** search (name + description) and a status filter, a real radio group (one Tab stop, arrow keys select). Option names include the count ("Needs attention, 2").
- **List:** one dense row per workspace (`WorkspaceRow`) — icon on its workspace colour (§6), status pill, models (with "N models need attention"), plants, datasets, updated, Settings, Models. The row links to `/plants/{id}` through a stretched link; actions sit above it (`z-10`) and are named after the workspace.
- **Order:** always by name — the server sends no order — with workspaces needing attention first (Serial Position). A workspace with an alerting node leads from the first paint; one that is Abnormal only through a model moves up once the models load. Nothing else moves.
- **Pagination:** 15 per page (`WORKSPACES_PAGE_SIZE`), Previous / Next and "16–30 of 50". Hidden for one page. A new search or filter returns to page 1; the stored page is clamped when the list shrinks; a page change scrolls the list back into view. The ends are `aria-disabled` (not `disabled`) so keyboard focus is never dropped.
- **Unknown is not zero:** an absent count renders "—" (screen readers hear "plants unknown"). The abnormal-model count is `null` until `useAllModels` has loaded. While it is `null` a workspace without an alerting node reads a neutral **Checking** pill (no status colour — never a green Normal that may flip), belongs to neither the Needs attention nor the Normal filter, and the summary and filter counts show "—". If the model list fails to load, an inline note offers "Try again".
- **Empty results** say why, by cause (`noMatchMessage`): a search that matches nothing blames the search; an empty "Needs attention" says "No workspace needs attention." Announced with `role="status"`.
- **Attention text** uses `BINARY_STATUS_META.abnormal.text` (`text-red-700 dark:text-red-400`), not `text-destructive`, which is too dim on the dark surface.
- **Models button** opens `/models/views?workspace={id}`. That page keeps its workspace filter in step with the URL (`hooks/workspace/use-workspace-url-filter.ts`): it follows the param when it changes on a mounted page, writes it back when the user picks a workspace, and falls back to All for an id the user does not have (`resolveWorkspaceFilter`).
- **Entry from Overview:** the Overview map header has a "View all workspaces" button (outline, solid surface so it reads on both map themes) linking here.
- **Pure logic** lives in `lib/workspace-list.ts` (status rule, payload mapping, search/filter, ordering, summary, empty-state wording, `paginate`, `resolveWorkspaceFilter`) and is unit-tested.

---

## 15. Admin dashboard

Added 2026-10-07. `/admin/dashboard` (`app/admin/dashboard/`); `/admin` redirects here. The two-column layout (B) was chosen over a single column (A, still available as `layout="console"` on `AdminDashboardView`).

- **Header:** `AdminSummaryHeader` — Display title, a mono summary line (`12 workspaces · 2 need attention · 46 models · 38 users`) and "Create workspace". No KPI cards, no health claim. Every segment is "—" until it has loaded; the attention segment is the only one coloured (`ATTENTION_TEXT`).
- **Layout (ops):** table left, a 22rem column right (attention queue above recent activity). The DOM order is the reading and Tab order at every width — attention, table, activity — and the columns are placed with grid placement from `lg`, never CSS `order`, so what is seen and what is announced never differ.
- **Attention queue:** workspaces whose **equipment** is in alarm, worst first, capped at 10 by the API with "and N more workspaces in alarm" under it. Only the "N in alarm" text is red; warnings and offline equipment are listed in muted text. Empty reads "No workspace needs attention." in neutral text — not a green all-clear. A failed load is an error with "Try again", never an empty queue.
- **Workspace table:** one dense row per workspace — icon, name, owner, **Equipment status**, models, plants, datasets, updated. Server-side search (debounced 300 ms) and pagination, 15 per page (`ADMIN_PAGE_SIZE`); a new search returns to page 1. A workspace with no equipment reads "No equipment", not Normal. An out-of-range page says "This page is empty" with a way back — it never claims the platform has no workspaces.
- **Status is equipment-only.** The admin API does not know model-level health (failed deploys, monitoring ALERT), so the column and queue are labelled "Equipment status" and nothing claims more. The binary rule is the same as everywhere (`isAbnormal`): only alarm is Abnormal; warning and offline are not alarms.
- **Recent activity:** the latest 8 sign-ins and sign-outs (admin activity is authentication), mono timestamps, "View all activity".
- **Data:** one summary request (`GET /admin/workspace/summary`, whole platform, unpaginated) plus the paginated list, which now carries real counts, `updatedAt` and the equipment roll-up. No per-workspace requests. The roll-up is counted in SQL (`nodeSummariesByWorkspace`, backend `lib/node-status-counts.ts`) — node JSON is never loaded — and is pinned to `deriveNodeSummary` by tests. Each section maps its own hook to a load state with the **error winning** — a failed or failed-refetch section is never shown as empty or healthy.
- **Refresh after create:** the summary and list reload only when a create **succeeded** — from this page's dialog or the sidebar's — via `workspacesRevisionAtom` (bumped by `useCreateWorkspace`). Cancelling reloads nothing; a failed create keeps the dialog open with what was typed.
- **One failure, one message:** a section that shows its error inline with "Try again" (table, activity) does not also toast (`notifyOnError: false`). Sections without an inline error (user stats) keep the toast. `usePaginatedFetch` drops any response that is not the latest request, so a slow old page or a superseded retry cannot overwrite newer rows or raise a stale error.
- **Reuse:** `StatusPill`, `CountValue`, `WorkspaceIconTile`, `ATTENTION_TEXT` and the pager live in `components/workspace/` and are shared with the user-facing All Workspaces list (§14).
- **Pure logic** lives in `lib/admin-dashboard.ts` and is unit-tested.
