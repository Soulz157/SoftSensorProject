'use client'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CRITERIA_VERDICT_SEPARATOR,
  type StatusExplanation,
} from '@/lib/monitoring-status-explain'
import {
  MONITORING_STATUS_CLASS,
  MONITORING_STATUS_CLASS_ON_TOOLTIP,
  MONITORING_STATUS_LABEL,
} from '@/lib/drift-status-style'
import type { PsiStatus } from '@/services/model-monitoring'

interface Props {
  /** `PsiStatus` is a superset of `DriftStatus`, so one prop serves both
   *  metrics. The label and both palettes are derived from it rather than
   *  passed in — a caller cannot pair one status's word with another's
   *  colour. */
  status: PsiStatus
  explanation: StatusExplanation
}

/**
 * A criteria line is `<condition> → <VERDICT>`, and the verdict half is
 * rendered as its own small badge so the tooltip shows the same colour
 * the table does. The verdict may carry a trailing aside — PSI's WARN
 * line ends `WARN (critical at 0.25)` — so only the LEADING token is
 * matched, and anything after it stays plain text beside the badge.
 *
 * Every comparison line carries a verdict now, including a passing one
 * (`|z| 0.30 < 1.5 → Good`). `null` is returned only for a line that is
 * not a comparison at all — the drift card header's "Hover a row's own
 * Status…" note — which renders as plain text, since inventing a badge
 * there would assert a verdict nothing computed.
 */
function splitVerdict(
  line: string,
): { condition: string; status: PsiStatus; rest: string } | null {
  const [condition, verdict] = line.split(CRITERIA_VERDICT_SEPARATOR)
  if (condition === undefined || verdict === undefined) return null

  const [token, ...remainder] = verdict.split(' ')
  if (!token) return null

  // Matched against the LABEL, not the wire value: a passing comparison
  // ends in "Good", which is `OK`'s display form, and looking the token
  // up as a status key directly would miss it and silently drop the
  // badge. One map owns that word (`MONITORING_STATUS_LABEL`), so this
  // keeps working if the wording changes again.
  const entry = Object.entries(MONITORING_STATUS_LABEL).find(
    ([, label]) => label === token,
  )
  if (!entry) return null

  return {
    condition,
    status: entry[0] as PsiStatus,
    rest: remainder.join(' '),
  }
}

/**
 * The status badge shared by the Distribution Drift and PSI cards: the
 * verdict, plus a tooltip saying what that verdict MEANS and which
 * comparison produced it.
 *
 * NOT `monitoring-tooltip.tsx` — that one is the recharts crosshair for
 * the chart series and is typed to `MonitoringRow`. This is a hover/focus
 * tooltip on a badge.
 *
 * WHY A COMPONENT RATHER THAN `title=`. Both badges previously carried
 * `title={col.reason}`, which shows only on the UNKNOWN rows that have a
 * reason and cannot render the measured-vs-threshold lines at all. The
 * copy itself is NOT written here — it comes from
 * `lib/monitoring-status-explain.ts`, so the two cards cannot end up
 * asserting different things about the same word.
 *
 * `TooltipProvider` is mounted per badge rather than once per panel. Both
 * panels render these inside cells built by `.map`, and the app has no
 * root provider — `isometric-map.tsx`, `tag-correlation-chart.tsx` and
 * every other consumer mount their own. One context per row is what those
 * consumers already pay, and it keeps this component self-contained.
 *
 * The trigger is a `<button>` so the tooltip is reachable by keyboard
 * rather than hover alone. `type="button"` because a default submit
 * button would be a trap if these tables ever land inside a form.
 *
 * THE CLICK IS SWALLOWED ON PURPOSE. `PsiRow` puts `onToggle` on the
 * `<tr>`, so without `stopPropagation` this button's click would bubble
 * and expand/collapse the bin drill-down — turning "I clicked the badge
 * to read it" into a row action the reader never asked for. The badge
 * itself has nothing to activate; the tooltip opens on hover and focus.
 */
export function StatusBadgeWithExplanation({ status, explanation }: Props) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={e => e.stopPropagation()}
            className="cursor-help rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Badge className={`border-0 ${MONITORING_STATUS_CLASS[status]}`}>
              {MONITORING_STATUS_LABEL[status]}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent className="grid max-w-xs space-y-1.5 text-left">
          {/* The verdict repeated as a BADGE, not bold text. The badge
              that opened this tooltip is behind the cursor by now, so
              restating it in the same shape and colour means the reader
              never has to match the explanation back to something they
              can no longer see. */}
          <Badge
            className={`w-fit border-0 ${MONITORING_STATUS_CLASS_ON_TOOLTIP[status]}`}
          >
            {MONITORING_STATUS_LABEL[status]}
          </Badge>
          <p className="text-xs leading-snug opacity-90">
            {explanation.meaning}
          </p>
          {explanation.criteria.length > 0 && (
            <ul className="space-y-1 border-t border-current/20 pt-1.5 font-mono text-[10px] leading-snug">
              {explanation.criteria.map(line => {
                const split = splitVerdict(line)

                // No verdict on this line — an under-the-line reading, or
                // a plain note. Rendered whole and unbadged: nothing here
                // fired, so nothing should draw the eye.
                if (!split) {
                  return (
                    <li key={line} className="opacity-80">
                      {line}
                    </li>
                  )
                }

                return (
                  <li key={line} className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold">{split.condition}</span>
                    <Badge
                      className={`border-0 px-1.5 py-0 font-mono text-[10px] ${MONITORING_STATUS_CLASS_ON_TOOLTIP[split.status]}`}
                    >
                      {MONITORING_STATUS_LABEL[split.status]}
                    </Badge>
                    {split.rest && (
                      <span className="opacity-70">{split.rest}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
