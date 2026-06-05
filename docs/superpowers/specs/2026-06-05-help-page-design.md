# Help & Support Page — Design Spec

**Date:** 2026-06-05  
**Route:** `/help`  
**Status:** Approved

---

## Context

Sidebar already links to `/help` via `HelpCircle` icon. No page exists yet. Users need a self-service reference for the SoftSensor platform (workspaces, canvas, nodes, soft sensor models, alerts).

---

## Layout

Two-column layout:

- **Left:** sticky sidebar nav, `w-64`, lists all sections grouped under 3 categories
- **Right:** scrollable content area, renders the active section
- Active section is tracked via local `useState` — no URL routing per section (no sub-routes needed)
- Mobile (`< lg`): left sidebar hidden, sections rendered as a horizontally-scrollable tab strip above the content area

### Left Nav Groups

| Group           | Items                                        |
| --------------- | -------------------------------------------- |
| Getting Started | Quick Start, Workspace Setup, Canvas & Nodes |
| Reference       | FAQ, Troubleshooting                         |
| Support         | Contact Support, System Status               |

Active item highlighted with `bg-primary/10 text-primary`. Inactive: `text-muted-foreground hover:text-foreground hover:bg-accent`.

---

## Sections (Mock Data)

### Quick Start

Numbered step cards (1–4):

1. Create a Workspace — click + New Workspace, set name/icon/color
2. Open the Canvas — switch to Build Mode
3. Add Your First Node — choose type (Machine / Sensor / Controller), set status
4. Monitor Alerts — sidebar badge pulses when alerts active (step card uses green checkmark accent)

Each step card: `bg-card border border-border rounded-xl`, numbered badge in `bg-primary`, description in `text-muted-foreground`.

### Workspace Setup

3 tip cards covering: naming conventions, icon/color selection, workspace status dots.

### Canvas & Nodes

4 tip cards: Build vs View mode, connecting nodes with edges, node types, confirming/cancelling edits.

### FAQ

Accordion (`shadcn/ui Accordion` component). 6 items:

1. What is a soft sensor model?
2. How do I connect a node to a model?
3. What triggers an Alarm status?
4. Can I export alert history?
5. How do I delete a node?
6. What does Offline status mean?

### Troubleshooting

4 items in same accordion pattern:

1. Canvas not loading
2. Nodes not saving after edit
3. Alert count badge not updating
4. Cannot create a workspace

### Contact Support

Single card: team email `support@softsensor.io`, "Copy Email" button (copies to clipboard + Sonner toast), "Send Email" button (`mailto:` link). No form.

### System Status

Status badge row — 3 services, all green:

- API Server — Operational
- Canvas Engine — Operational
- Alert Service — Operational

Last checked timestamp (static mock: "Checked just now").

---

## File Structure

```
apps/client/app/(default)/help/
  page.tsx          # server component shell, renders <HelpContent />
  loading.tsx       # skeleton
  error.tsx         # error boundary
  components/
    help-content.tsx      # 'use client' — state, two-column layout
    help-nav.tsx          # left sidebar nav
    section-quick-start.tsx
    section-workspace-setup.tsx
    section-canvas-nodes.tsx
    section-faq.tsx
    section-troubleshooting.tsx
    section-contact.tsx
    section-status.tsx
```

---

## Component Rules

- `page.tsx` is a Server Component — no `'use client'`
- `help-content.tsx` owns `activeSection` state (`useState<string>('quick-start')`)
- All mock data defined as `const` arrays inside each section component — no API calls
- Use `shadcn/ui Accordion` for FAQ and Troubleshooting sections (`npx shadcn@latest add accordion` if not present)
- Use `cn()` from `@/lib/utils` for conditional classes
- No hardcoded hex colors — use CSS variable tokens only (`bg-card`, `text-foreground`, etc.)
- `error.tsx` and `loading.tsx` required per CLAUDE.md route segment rule

---

## Design Tokens Used

| Purpose                  | Token                                |
| ------------------------ | ------------------------------------ |
| Page bg                  | `bg-background`                      |
| Nav bg                   | `bg-card border-r border-border`     |
| Active nav item          | `bg-primary/10 text-primary`         |
| Step badge (numbered)    | `bg-primary text-primary-foreground` |
| Step badge (done)        | `bg-emerald-500 text-white`          |
| Card surface             | `bg-card border border-border`       |
| Section title            | `text-foreground`                    |
| Body text                | `text-muted-foreground`              |
| Status dot — operational | `bg-emerald-500`                     |

---

## Verification

1. `pnpm format && pnpm build` — no errors
2. Navigate to `/help` — page renders, no layout shift
3. Click each nav item — right panel switches section
4. FAQ accordion opens/closes
5. "Copy Email" button — Sonner toast fires, clipboard updated
6. Toggle dark/light — all tokens respond correctly, no hardcoded colors visible
7. Mobile: layout stacks (sidebar above content or collapsed)
