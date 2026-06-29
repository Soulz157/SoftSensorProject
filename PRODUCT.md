# Product

## Register

product

## Users

Three roles, one tool — each has a distinct primary task:

- **Plant engineers / operators**: Monitor sensor health across a canvas-based floor layout. Catch anomalies, investigate alarms, keep machines running. Task-focused, fast loops, frequent context switching between workspaces.
- **Data scientists / ML engineers**: Build and evaluate soft sensor AI models. Compare runs, track model drift, validate predictions against real sensor data. Analytical mode, longer sessions, detail-heavy.
- **Operations managers / plant directors**: Cross-facility oversight at a glance — alarm counts, node status summaries, trend signals. Strategic view, not operational depth.

Context: industrial environments, often accessed on desktop workstations in ops rooms or offices. Users are technical professionals with domain expertise; they don't need hand-holding.

## Product Purpose

SoftSensor is a smart monitoring platform for industrial soft sensor management and AI model analytics. It gives multi-disciplinary industrial teams a single interface to visualize plant health (canvas node graphs), manage AI model pipelines, track alarms and anomalies, and oversee multiple facilities in one view.

Success looks like: an operator opens the app, finds a system deviation in under 10 seconds, traces it to the right node or model, and acts without friction.

## Brand Personality

Smart · Clean · Expert

Professional confidence without heaviness. The UI steps back so data surfaces can speak. Think Linear or Retool — competent, focused, opinionated but not loud. Not a consumer SaaS. Not a legacy SCADA system.

## Anti-references

- **Legacy SCADA / DCS systems** (OSIsoft PI, Wonderware, Ignition): avoid the heavy chrome, low-res grid aesthetic, cluttered operator panels, and the dated dark-background-with-neon-widget look. SoftSensor should feel like it was built in the present.
- **Consumer SaaS softness** (Notion, Airtable): no pastel palettes, friendly rounded blobs, or marketing-page warmth inside the app shell. Industrial software earns trust through precision, not personality.
- **Generic dark-mode dashboard grids** (Grafana, Tableau): avoid the assembled-from-widgets look. SoftSensor should feel purpose-built for this domain, with clear visual hierarchy and editorial restraint.

## Design Principles

1. **UI steps back so data speaks** — decoration earns nothing; density earns everything. Empty visual territory is not a problem to fill.
2. **Expert confidence** — users know the domain. Skip tutorial scaffolding, progressive-disclosure prompts, and friendly-empty-state illustrations. Respect intelligence.
3. **Alarms earn attention** — status signals (alarm, warning, offline, normal) must be unmistakable and never ambiguous. Color alone is not enough; shape and label reinforce.
4. **One truth per screen** — every route has a primary job. Managers get the overview, engineers get the canvas, scientists get the model pipeline. Don't collapse roles into soup.
5. **Consistent across personas** — shared components (sidebar, status indicators, pagination, tables) behave identically regardless of which role is using them. No per-role UI surprises.

## Accessibility & Inclusion

- WCAG 2.1 AA compliance minimum.
- Both light and dark themes must pass 4.5:1 body contrast and 3:1 large-text contrast.
- Status signals (alarm/warning/offline/normal) must not rely on color alone — reinforce with icons and labels.
- Full keyboard navigation and visible focus rings.
- `prefers-reduced-motion` respected for all transitions.
- Theme defaults to the OS preference (`prefers-color-scheme`); user may override.
