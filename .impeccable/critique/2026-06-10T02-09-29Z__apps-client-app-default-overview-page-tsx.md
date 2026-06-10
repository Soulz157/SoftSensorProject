---
target: overview
total_score: 19
p0_count: 0
p1_count: 3
p2_count: 3
timestamp: 2026-06-10T02-09-29Z
slug: apps-client-app-default-overview-page-tsx
---

## Design Health Score

| #         | Heuristic                         | Score     | Key Issue                                                                                                             |
| --------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status       | 2         | HUD shows overall status but offline-shows-green bug; no in-flight loading indicator for node fetches                 |
| 2         | Match System / Real World         | 2         | "Sub-company workspace" placeholder text; double-click navigation undocumented; "Plants" vs "Workspaces" naming drift |
| 3         | User Control and Freedom          | 2         | Panel closeable; can deselect by clicking selected tower; no keyboard Escape; no undo                                 |
| 4         | Consistency and Standards         | 2         | `text-blue-500` hardcoded 3×; `->` vs `→`; tiny-uppercase eyebrow pattern 4× instances; monospace workspace names     |
| 5         | Error Prevention                  | 2         | Offline-shows-green bug in HUD color; accidental double-click navigation with no confirmation                         |
| 6         | Recognition Rather Than Recall    | 1         | Double-click navigation completely undiscovered; no tooltips on towers; 8px truncated name labels; no map legend      |
| 7         | Flexibility and Efficiency of Use | 1         | Mouse-only (no keyboard nav, no touch pan); no zoom; no shortcuts                                                     |
| 8         | Aesthetic and Minimalist Design   | 3         | Clean overall; `backdrop-blur-xl` on detail panel and HUD is decorative glassmorphism                                 |
| 9         | Error Recovery                    | 3         | `PlantsError` boundary shows message + retry; solid                                                                   |
| 10        | Help and Documentation            | 1         | No tooltips on map interactions; no legend; double-click behavior invisible; no onboarding for empty state            |
| **Total** |                                   | **19/40** | **Poor — major gaps in accessibility, status accuracy, discoverability**                                              |

---

## Anti-Patterns Verdict

**LLM assessment**: The isometric SVG map is genuinely distinctive — it's not a generic card grid or a dark dashboard cobbled from widgets, and that earns real credit. The concept fits the "Precision Instrument" north star and avoids the main AI-slop traps. Where the AI grammar shows through is the detail panel: four instances of the tiny-uppercase-eyebrow pattern (`text-[10px] font-semibold uppercase tracking-wider`) on "System Status", "Summary", "Alarms (n)", "Warnings (n)". That's the exact reflex signature — an eyebrow appears above every section because the AI scaffolded every section the same way. One instance is voice; four is grammar.

**Deterministic scan**: Detector returned 0 findings (exit 0). No gradient text, no side-stripe borders, no numbered section markers, no identical card grids. The banned absolute patterns are clean.

**Visual overlays**: No browser automation available; no live overlay run this session. Fallback: static source review only.

---

## Overall Impression

The concept is strong — an isometric overview map is the right UX choice for multi-facility monitoring at the manager/operator level, and the implementation has real craft in the SVG geometry. The critical gap is functional safety: a status bug makes an offline system look green in the HUD (a direct violation of The Status Contract), and the entire map is inaccessible via keyboard. These aren't polish issues — they undermine trust in a tool where status accuracy is the core value proposition.

---

## What's Working

1. **Isometric map concept** — The SVG tower visualization is creative and domain-appropriate. Towers with height derived from node count, status glows, and dashed-ring selection state are genuine product-level design choices that would read as intentional to any industrial user.
2. **Status hierarchy logic** — `deriveStatus()` correctly implements alarm > offline > warning > normal priority. This logic is consistent across `overview-map`, `overview-tower`, and `overview-detail-panel`. The tower's top-face color, glow radius, and beacon accurately reflect the workspace's worst state.
3. **Error boundary** — `PlantsError` shows the error message, logs for debugging, and provides a working retry button. Clean, recoverable, follows conventions.

---

## Priority Issues

**[P1] Offline status shows as green in the HUD**

- **What**: `overallColor` computation: `overallStatus === 'alarm' ? '#ef4444' : overallStatus === 'warning' ? '#f59e0b' : '#22c55e'`. The `offline` case falls through to green.
- **Why it matters**: An industrial monitoring tool that shows "OFFLINE" in green destroys operator trust. If a facility goes offline, the command-center HUD shows all-clear green. This is a functional bug with safety implications.
- **Fix**: Add the offline case: `overallStatus === 'offline' ? '#71717a' : '#22c55e'`. Also apply to the `overallColor` used in the HUD text.
- **Suggested command**: `/impeccable polish overview`

**[P1] Status communicated by color alone on the map**

- **What**: Tower status is shown via top-face color and glow. The tower name label shows a colored dot with no text. No text label, no icon visible on the tower for status.
- **Why it matters**: DESIGN.md's "The Status Contract" is explicit — status must be color + icon + label, never color alone. Colorblind users (8% of males have red-green deficiency) cannot distinguish alarm (#ef4444) from warning (#f59e0b) towers. In a monitoring context this is a WCAG failure.
- **Fix**: Add a status label to the tower name badge (e.g., a single capital letter or abbreviated status text alongside the dot: "⚠" or just "ALM" in the badge). The detail panel correctly uses icon + text; the map should match.
- **Suggested command**: `/impeccable audit overview`

**[P1] Map is mouse-only — no keyboard or touch access**

- **What**: `onMouseDown/Move/Up` handlers on the SVG, no `tabIndex` on tower groups, no `onKeyDown`, no touch events.
- **Why it matters**: Keyboard-only users (Sam persona) cannot select any workspace or navigate the overview at all. The entire primary surface of the page is inaccessible. This is WCAG 2.1 AA failure (Success Criterion 2.1.1 Keyboard).
- **Fix**: Add `tabIndex={0}` to tower `<g>` elements, `onKeyDown` for Enter/Space to select, and `onTouchStart/Move/End` equivalents of the pan handlers. Long-term, consider a keyboard-navigable fallback table of workspaces below the map.
- **Suggested command**: `/impeccable audit overview`

**[P2] Four tiny-uppercase-eyebrow instances — AI scaffold pattern**

- **What**: `text-[9px] font-bold uppercase tracking-widest` (HUD "System Status"), `text-[10px] font-semibold uppercase tracking-wider` (panel "Summary", "Alarms (n)", "Warnings (n)").
- **Why it matters**: Per DESIGN.md and the absolute bans, an uppercase tracked eyebrow above every section is AI grammar. Four instances confirms the pattern. The 9px text in the HUD is also sub-accessible.
- **Fix**: Replace section dividers in the detail panel with a simple `text-xs text-muted-foreground` label or a horizontal rule with label inline. Replace the HUD "System Status" label with a status badge or just remove it (the status value is self-evident).
- **Suggested command**: `/impeccable typeset overview`

**[P2] `text-blue-500` hardcoded 3× in StatCell — breaks token system**

- **What**: `valueClass="text-blue-500"` for Equipment count and Models count in the 2×2 stats grid.
- **Why it matters**: `text-blue-500` is a Tailwind raw color, not a system token. It won't track theme changes, looks different than `text-primary` (Signal Blue is `oklch(0.55 0.18 250)`, not exactly Tailwind's `blue-500`), and breaks the "Signal Blue for data signals only" convention from DESIGN.md.
- **Fix**: Replace with `text-primary`. Equipment/models counts are neutral facts; if color emphasis is needed for alarms only, leave normals as `text-foreground`.
- **Suggested command**: `/impeccable polish overview`

**[P2] "Sub-company workspace" hardcoded placeholder in detail panel**

- **What**: Line 110: `<p className="text-xs text-muted-foreground">Sub-company workspace</p>` — static string, not from data.
- **Why it matters**: Every workspace shows "Sub-company workspace" as a subtitle. This reads as unfinished to any user and would immediately prompt a support query.
- **Fix**: Replace with the workspace description field (if it exists in the data model) or remove the line entirely. If there's no description field, delete the element; an empty slot is better than a wrong one.
- **Suggested command**: `/impeccable harden overview`

---

## Persona Red Flags

**Plant Operator (domain expert, primary user)**

- Opens the overview to check system health immediately. The HUD correctly surfaces this — but the offline-shows-green bug means if a facility is offline, the operator sees green and assumes all clear. Direct mismatch between physical reality and dashboard readout.
- Wants to click through to the affected workspace fast. The single-click → detail panel → "View Workspace" button is 3 interactions. Double-click to navigate directly is hidden. No keyboard shortcut.

**Alex (Power User)**

- Expects keyboard navigation. The SVG map has no `tabIndex` — pressing Tab skips the entire map. Cannot select any workspace without a mouse.
- The only "shortcut" is double-click to navigate, and it's undocumented. Alex would find it accidentally or not at all.
- No batch view or keyboard shortcut to quickly navigate between workspaces.

**Sam (Accessibility-Dependent)**

- The entire map surface is inaccessible via keyboard. VoiceOver has no semantic hooks into the SVG — no `role`, no `aria-label` on tower groups, no `aria-live` region for status changes.
- Color-only status signals fail for red-green colorblind users. The alarm (red) and warning (amber) towers are visually distinguishable by hue, but the normal (accent-colored) vs offline (grey) and warning vs alarm distinction will fail under various deficiency types.
- The 8px monospace name labels in the SVG are below minimum readable size at any screen density.

---

## Minor Observations

- `loading.tsx` provides a skeleton, but `page.tsx` returns `null` while node data loads (after workspaces are already available). This creates a flash-of-blank on the workspace-loaded-but-nodes-pending state.
- Tower name label uses `fontFamily="monospace"` — workspace names are human prose, not data values. Per the Mono Contract, monospace is reserved for sensor readings, IDs, and numeric values.
- Detail panel button copy: "View Workspace →" uses Unicode `→`; "Open Pipeline Editor ->" uses ASCII `->`. Fix the second one.
- Double-click to navigate is the only fast-path, but it's invisible. At minimum, add a tooltip or a hint line in the detail panel ("Double-click tower to open directly").
- The `workspaces.length === 0` empty state shows an empty isometric canvas with "0 plants monitored" — no call to action, no guidance. This breaks the "Expert confidence — no tutorial scaffolding" principle in a bad way: experts need feedback when the system is genuinely empty vs when it's still loading.

---

## Questions to Consider

- The HUD shows "Plants Online" but the count never decreases when a plant goes offline (it shows all workspaces, not just online ones). Should "Plants Online" be a live count of non-offline workspaces?
- The detail panel opens by clicking a tower and closes with the X button. Should clicking the map background also close it? Right now click-outside doesn't dismiss.
- Keyboard navigation is the hardest part to retrofit onto an SVG canvas. Would a keyboard-navigable workspace list below the map (or in a sidebar collapse) satisfy the accessibility requirement while keeping the visual map as the hero?
