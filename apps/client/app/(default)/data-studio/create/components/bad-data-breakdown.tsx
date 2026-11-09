'use client'

import { isLabTag } from '@/lib/lab-tag'
import { LAB_STALE_MULTIPLIER } from '@/lib/data-quality'

export interface BadDataDetail {
  bad: number
  questionable: number
  frozen: number
  reasons?: Array<{ label: string; count: number }>
}

interface Props {
  tag: string
  badCount: number
  detail?: BadDataDetail
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint: string
}) {
  return (
    <div className="rounded-md bg-muted px-2 py-1.5">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  )
}

export function BadDataBreakdown({ tag, badCount, detail }: Props) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs font-semibold text-foreground">{tag}</p>

      {detail ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Tile label="Missing" value={detail.bad} hint="rows" />
            <Tile label="Null" value={detail.questionable} hint="rows" />
            <Tile label="Frozen" value={detail.frozen} hint="rows" />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {/* NOTE: lab tags use a different Frozen rule (`qualityByTag`) —
                stated here so the figure is never read as the 3h rule. */}
            {isLabTag(tag)
              ? `Lab tag: Frozen = value unchanged longer than ${LAB_STALE_MULTIPLIER}× its usual change interval (at least 3 days). The 3h sensor rule does not apply — a lab value is carried forward between samples.`
              : 'Frozen = value unchanged for 3h or more.'}
          </p>

          {detail.reasons && detail.reasons.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Top reasons
              </p>
              <ul className="space-y-1">
                {detail.reasons.map(r => (
                  <li
                    key={r.label}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate text-muted-foreground">
                      {r.label}
                    </span>
                    <span className="shrink-0 font-mono font-medium text-foreground">
                      {r.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">
            {badCount}
          </span>{' '}
          row{badCount === 1 ? '' : 's'} flagged as Bad, Questionable, or
          Frozen. Detailed breakdown not available for this tag.
        </p>
      )}
    </div>
  )
}
