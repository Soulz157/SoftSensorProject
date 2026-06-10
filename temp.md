---

What was written:

- PRODUCT.md — register: product. Three-persona users (engineers, data scientists, managers). Personality: Smart · Clean · Expert. Anti-refs: legacy SCADA/DCS, consumer SaaS softness, generic dashboard grids. Five design principles.
- DESIGN.md — Creative North Star: "The Precision Instrument". Full YAML frontmatter with OKLCH tokens, typography scale, radius/spacing, component specs. Six-section spec: Overview, Colors (Signal Palette), Typography, Elevation, Components, Do's and Don'ts.
- .impeccable/design.json — sidecar with tonal ramps, shadow/motion tokens, 7 self-contained component HTML/CSS snippets (primary button, ghost, destructive, card, input, status badge, nav item), full narrative.
- .impeccable/live/config.json — live mode pre-configured for Next.js App Router at apps/client/app/layout.tsx.

Five principles guiding future work:

1. UI steps back so data speaks
2. Expert confidence — no tutorial scaffolding
3. Alarms earn attention — status always color + icon + label
4. One truth per screen — don't collapse roles
5. Consistent across personas — no per-role UI surprises

Best commands to run next:

- /impeccable critique overview — the Overview page is the most visible multi-persona surface; a scored review will surface the biggest UX gaps fast.
- /impeccable audit workspaces — workspace cards and the canvas editor are data-dense and worth an a11y + contrast audit against the WCAG AA target now documented.
- /impeccable live — live mode is configured; boot it to iterate on any page's design in the browser.
