---
name: SoftSensor
description: Smart monitoring platform for industrial soft sensor management and AI model analytics.
colors:
  signal-blue: 'oklch(0.55 0.18 250)'
  signal-blue-dark: 'oklch(0.6 0.18 250)'
  surface: 'oklch(0.985 0.005 250)'
  surface-raised: 'oklch(1 0 0)'
  surface-deep: 'oklch(0.1 0.015 250)'
  surface-card-dark: 'oklch(0.14 0.02 250)'
  ink: 'oklch(0.15 0.02 250)'
  ink-dark: 'oklch(0.95 0.01 250)'
  muted-surface: 'oklch(0.95 0.01 250)'
  muted-ink: 'oklch(0.5 0.02 250)'
  sidebar-surface: 'oklch(0.97 0.005 250)'
  sidebar-surface-dark: 'oklch(0.08 0.015 250)'
  border: 'oklch(0.9 0.02 250)'
  border-dark: 'oklch(0.22 0.02 250)'
  alarm-red: 'oklch(0.577 0.245 27.325)'
  status-warning: '#f59e0b'
  status-offline: '#71717a'
  status-normal: '#10b981'
typography:
  display:
    fontFamily: 'Geist Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: 'clamp(1.5rem, 2.5vw, 2rem)'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.02em'
  title:
    fontFamily: 'Geist Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: 'Geist Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Geist Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: '0.25rem'
  md: '0.375rem'
  lg: '0.5rem'
  xl: '0.75rem'
  full: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.signal-blue}'
    textColor: 'oklch(0.99 0 0)'
    rounded: '{rounded.lg}'
    padding: '8px 16px'
    height: '2.25rem'
  button-primary-hover:
    backgroundColor: 'oklch(0.48 0.18 250)'
    textColor: 'oklch(0.99 0 0)'
  button-outline:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '8px 16px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '8px 16px'
  button-destructive:
    backgroundColor: 'oklch(0.577 0.245 27.325 / 0.1)'
    textColor: '{colors.alarm-red}'
    rounded: '{rounded.lg}'
    padding: '8px 16px'
  card:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: '16px'
  input:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    height: '2rem'
    padding: '4px 10px'
---

# Design System: SoftSensor

## 1. Overview

**Creative North Star: "The Precision Instrument"**

SoftSensor's visual system is calibrated, not decorated. Like a high-end oscilloscope or industrial measurement device, every visual element earns its place through function. The surface steps back; the data reads forward. Status indicators are unmistakable. Typography prioritizes legibility. Whitespace is rationed, not squandered.

This system refuses the aesthetic of legacy SCADA/DCS software — the heavy chrome, the neon-on-black widget grids, the cluttered operator panels that look frozen in 1998. It equally refuses the warm consumer-SaaS softness of Notion or Airtable (no pastel palettes, no friendly rounded blobs inside the app shell), and the assembled-from-widgets look of Grafana or Tableau (no dark-mode grid of loosely related charts). SoftSensor is purpose-built for domain experts who don't need hand-holding and distrust anything that looks like a demo.

The result looks like it was made by someone who actually understands industrial monitoring: spare, confident, fast to scan, impossible to misread. The blue-indigo primary is used with precision — as an active-state signal, not decoration. The two-theme system (light for offices, dark for ops floors) is equally polished; neither is an afterthought.

**Key Characteristics:**

- Signal Blue (blue-indigo primary) used only for active states, primary actions, and data links — never decoratively
- Near-white / deep-navy dual-theme surfaces; zero warm-neutral tinting
- Tonal layering over drop-shadows: depth via rings and background shifts, never blur or shadow stacking
- Geist Sans throughout; Geist Mono for data values, IDs, and sensor readings
- Compact body text at 0.875rem; data-density over breathing room
- Status colors (alarm/warning/offline/normal) are system-level conventions — always paired with icon + label, never used decoratively

## 2. Colors: The Signal Palette

A cool, precise palette anchored in blue-indigo (hue 250). No warm neutrals, no decorative accents. Every surface, border, ink value, and the primary accent share the same hue axis — the system reads as a single coherent instrument panel.

### Primary

- **Signal Blue** (`oklch(0.55 0.18 250)` light / `oklch(0.6 0.18 250)` dark): The single active-state color. Used for primary buttons, active nav items, focus rings, links, and confirmed-status indicators. Never used decoratively or as background fill for content surfaces.

### Neutral

- **Instrument Surface** (`oklch(0.985 0.005 250)`): Root light-mode background. Near-white with exactly 0.005 chroma toward hue 250. Not warm, not cold — instrument white.
- **Pure Card** (`oklch(1 0 0)`): Card backgrounds in light mode. One lightness step above `surface` creates tonal depth without shadows.
- **Deep Navy** (`oklch(0.1 0.015 250)`): Root dark-mode background. Near-black with a faint blue-navy cast.
- **Dark Card** (`oklch(0.14 0.02 250)`): Card backgrounds in dark mode.
- **Deep Ink** (`oklch(0.15 0.02 250)`): Primary text on light surfaces. Not pure black — tinted toward the hue axis.
- **Light Ink** (`oklch(0.95 0.01 250)`): Primary text on dark surfaces.
- **Muted Surface** (`oklch(0.95 0.01 250)` light): Secondary background for hover states, table rows, secondary zones.
- **Muted Ink** (`oklch(0.5 0.02 250)`): Secondary text, metadata, placeholder labels. Verify 4.5:1 against parent surface before shipping.
- **Instrument Border** (`oklch(0.9 0.02 250)` light / `oklch(0.22 0.02 250)` dark): Hairline dividers and ring outlines. Used exclusively for structural edge definition.
- **Sidebar Surface** (`oklch(0.97 0.005 250)` light / `oklch(0.08 0.015 250)` dark): Slightly distinct from page background, giving the sidebar a recessed feel without a hard separator.

### Status Colors (system-level)

These four colors are semantic infrastructure. They communicate operating state across every surface and are not available for decorative use.

- **Alarm Red** (`oklch(0.577 0.245 27.325)` / `#ef4444` sRGB approx.): Active alarm, critical fault.
- **Warning Amber** (`#f59e0b`): Warning condition, degraded performance.
- **Offline Gray** (`#71717a`): Device unreachable, disconnected.
- **Normal Green** (`#10b981`): Healthy operating state.

**The Signal Rule.** Signal Blue is used on ≤15% of any given screen. Its rarity is how it communicates activity — if Signal Blue covers half the screen, it stops being a signal and becomes noise.

**The Status Contract.** Status colors (alarm/warning/offline/normal) are never used for decorative purposes. Using `#10b981` for a success illustration borrows from the operating-state budget. When an operator's attention is on a green dot, it must mean "healthy" — nothing else.

## 3. Typography

**Body Font:** Geist Sans (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Mono Font:** Geist Mono (with `ui-monospace, SFMono-Regular, monospace` fallback)

**Character:** A clean single-family system. Geist Sans handles all hierarchy through weight and size alone; Geist Mono surfaces numeric readings, sensor IDs, and code strings. No display font, no decorative serif. The typography is a readout, not a statement.

### Hierarchy

- **Display** (600, `clamp(1.5rem, 2.5vw, 2rem)`, lh 1.2, ls -0.02em): Page-level headings — workspace names, major section titles. Used at most once per view.
- **Title** (500, 1rem, lh 1.4): Card headings, panel labels, sidebar section names.
- **Body** (400, 0.875rem, lh 1.5): Default text across all data-dense surfaces, tables, lists, descriptions. Max line length 72ch.
- **Label** (500, 0.75rem, lh 1.4): Form labels, metadata tags, column headers. Not uppercase.
- **Mono** (400, 0.8125rem, lh 1.6): Sensor readings, node IDs, timestamps, numeric values, model parameters. Geist Mono exclusively.

**The Mono Contract.** Numeric sensor readings and identifiers are always rendered in Geist Mono. Proportional text for data values makes table columns harder to scan and blurs the boundary between "system data" and "human prose."

**The Weight Ceiling Rule.** Maximum in-use font weight is 600 (semibold). Font-weight 700+ is not used — it reads as alarmed or shouting in a system that needs to read as calm and authoritative.

## 4. Elevation

This system is flat by default. Depth is conveyed through tonal layering — background shifts and hairline rings — not through drop-shadows. A card sits one lightness step above the page background (`oklch(1 0 0)` on `oklch(0.985 0.005 250)`). Nested surfaces are not permitted.

### Shadow Vocabulary

- **No shadows on resting surfaces.** Cards, panels, and containers use `ring-1 ring-foreground/10` (a translucent hairline ring) for edge definition. This is structural, not decorative.
- **Ambient shadow for floating elements** (`0 4px 24px rgba(0,0,0,0.08)` light / `0 4px 24px rgba(0,0,0,0.32)` dark): Used exclusively for dropdowns, modals, tooltips, and command palettes — elements that float above the document layer. The shadow marks that distinction.
- **No hover lift.** Hover states use background tint (`bg-muted`). Shadows do not appear on hover to simulate a "lift" effect.

**The Flat-by-Default Rule.** A shadow on a static card is a question mark: "why is this floating?" If there's no clear answer — the element is modal, dropdown, or detached from the document flow — the shadow doesn't belong.

## 5. Components

### Buttons

Consistent corner radius system-wide: `rounded-lg` (0.5rem / 8px). Direct and compact. No animation theatrics; a translate-y-px on active is the extent of physical feedback.

- **Primary:** Signal Blue (`oklch(0.55 0.18 250)`), white text, h-9 (2.25rem), px-4. Hover: `oklch(0.48 0.18 250)` (darkened). Focus: `ring-3 ring-ring/50`. Active: 1px down translate.
- **Outline:** `border-border` with `bg-background`. Hover: `bg-muted`. Used when a primary already owns the hierarchy.
- **Ghost:** No border, no background. `hover:bg-muted`. Used in toolbars, sidebar actions, icon buttons.
- **Destructive:** Alarm Red at 10% opacity background, full Alarm Red text. Always paired with a destructive icon.
- **Link:** Signal Blue text, `underline-offset-4`, underline on hover. No background treatment.
- **Sizes:** `sm` (h-8, rounded-md), `default` (h-9, rounded-lg), `lg` (h-10, rounded-md, px-6). Icon variants: `icon-sm` (2rem), `icon` (2.25rem), `icon-lg` (2.5rem).

### Cards / Containers

- **Corner style:** Gently rounded — `rounded-xl` (0.75rem / 12px).
- **Background:** `bg-card` — pure white in light mode, `oklch(0.14 0.02 250)` in dark.
- **Border:** `ring-1 ring-foreground/10` — a hairline translucent ring, not a hard `border`. Creates edge definition without color commitment.
- **Shadow:** None at rest. See Elevation.
- **Internal padding:** `py-4 px-4` (16px). Card header with a divider uses `pb-4` on the header block.
- **Nesting:** Never nest cards inside cards. Sub-surfaces within a card use `bg-muted` with no ring.

### Inputs / Fields

- **Style:** Transparent background, `border border-input` (`oklch(0.92 0.01 250)`), `rounded-lg` (0.5rem). Height: `h-8` (2rem). Text: `text-sm`.
- **Focus:** Border shifts to Signal Blue + `ring-3 ring-ring/50` halo.
- **Placeholder:** `text-muted-foreground` — must pass WCAG AA 4.5:1 on its background. If muted foreground fails, darken toward ink end of the ramp.
- **Error:** `aria-invalid` triggers `border-destructive ring-destructive/20`.
- **Disabled:** `opacity-50`, no pointer events. Dark: `bg-input/80` fill.

### Navigation / Sidebar

- **Width:** 240px expanded, 48px collapsed. Transition on collapse state.
- **Background:** `bg-sidebar` — `oklch(0.97 0.005 250)` light / `oklch(0.08 0.015 250)` dark. One step recessed from the page background, giving it a contained feel.
- **Active state:** Signal Blue text + icon; `bg-accent` background tint on the active row.
- **Hover:** `hover:bg-accent` — the muted-blue tint consistent throughout the system.
- **Item typography:** Body (0.875rem) for primary nav; Label (0.75rem) for sub-items and section dividers.
- **Alert badge:** Alarm count badge on sidebar items uses alarm-red/warning-amber with white text. Visible when count > 0; hidden (not zero-displayed) when count is 0.
- **Serial Position:** Alerts item is positioned near the top of primary nav — operators need it fast. Workspace/canvas items follow.

### Status Indicators (Signature Component)

Status dots and badges are core SoftSensor primitives — they appear in the sidebar, workspace cards, the overview map, and the alerts table.

- **Status dot:** 0.5rem circle, no label. Dense lists where space is at a premium.
- **Status badge:** Dot + short capitalized label (`Alarm`, `Warning`, `Offline`, `Normal`). Tables and detail panels. Color AND label always — never color alone.
- **Color map:** alarm → `bg-red-500`, warning → `bg-amber-500`, offline → `bg-zinc-500`, normal → `bg-emerald-500`.
- **Alarm pulse:** Active alarm dots use an animated ring (`ring-2 ring-red-500/40 animate-pulse`). Must degrade to a static ring under `prefers-reduced-motion: reduce`.

### Badges / Tags

- **Shape:** Fully pill (`rounded-full`), h-5 (1.25rem), px-2, text-xs.
- **Default:** Signal Blue background, white text.
- **Secondary:** `bg-secondary`, secondary foreground text.
- **Destructive:** `bg-destructive/10`, alarm red text.
- **Outline:** `border-border`, body ink text.
- **Size:** Fixed at `h-5 px-2 text-xs` throughout — not resized per context. One size, always.

## 6. Do's and Don'ts

### Do:

- **Do** use `ring-1 ring-foreground/10` for card edge definition — never `border` or `box-shadow` on resting surfaces.
- **Do** pair every status color with both an icon and a text label — color alone does not satisfy WCAG or operational clarity.
- **Do** render all numeric sensor readings, IDs, timestamps, and model parameters in Geist Mono.
- **Do** hold Signal Blue to ≤15% surface coverage per screen to preserve its role as an active-state signal.
- **Do** test both themes (light and dark) against WCAG 2.1 AA: 4.5:1 for body and placeholder text, 3:1 for large text. Verify `muted-foreground` on `background` — this is the most common failure.
- **Do** provide `prefers-reduced-motion` fallbacks for every animation (alarm pulse → static ring; transitions → instant swap).
- **Do** keep maximum font weight at 600 (semibold) — no bold or extrabold usage.
- **Do** anchor depth in tonal lightness steps (`surface` → `surface-raised` → `muted-surface`), not shadows.

### Don't:

- **Don't** use legacy SCADA/DCS aesthetics: no heavy chrome outlines, no neon-on-dark widget grids, no low-density operator panel layouts that look like Wonderware or OSIsoft PI.
- **Don't** bring consumer-SaaS softness into the app shell: no pastel palette, no warm-tinted neutrals (the entire warm-neutral band — OKLCH lightness 0.84–0.97, chroma < 0.06, hue 40–100 — is off-limits as a surface color), no friendly rounded-blob empty states or onboarding illustrations.
- **Don't** produce an assembled-from-widgets dark-mode grid (Grafana / Tableau aesthetic). Every screen has editorial structure.
- **Don't** use gradient text (`background-clip: text` with a gradient background). A precision instrument does not have gradient labels.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on cards or list items. It reads as SCADA chrome. Use a background tint or a leading status dot instead.
- **Don't** use glassmorphism or `backdrop-filter: blur` on resting surfaces — decorative, not precision.
- **Don't** nest cards inside cards. One tonal surface layer per view.
- **Don't** apply drop-shadows to resting static cards. Floating elements (modals, dropdowns) may use ambient shadow; everything else stays flat.
- **Don't** use status colors (alarm red, warning amber, normal green, offline gray) for anything other than operating state — they are system infrastructure, not palette.
- **Don't** use font-weight 700 or higher anywhere in the UI.
