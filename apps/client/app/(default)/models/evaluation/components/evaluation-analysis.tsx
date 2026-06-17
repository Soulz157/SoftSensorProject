import { ClipboardList, Lightbulb, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { EvalAnalysis } from '@/lib/model-evaluation'

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export function EvaluationAnalysis({
  analysis,
  isGenerating,
}: {
  analysis: EvalAnalysis | null
  isGenerating: boolean
}) {
  if (isGenerating) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="space-y-5 pt-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (!analysis) return null

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-6 pt-5">
        <Section
          icon={<TrendingUp className="h-4 w-4" />}
          title="Graph Explanation"
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            {analysis.graphExplanation}
          </p>
        </Section>

        <Section
          icon={<ClipboardList className="h-4 w-4" />}
          title="Root Cause Analysis"
        >
          <ul className="space-y-2">
            {analysis.rootCause.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section
          icon={<Lightbulb className="h-4 w-4" />}
          title="Actionable Suggestions"
        >
          <ol className="space-y-2">
            {analysis.suggestions.map((item, i) => (
              <li
                key={i}
                className="flex gap-2.5 text-sm leading-relaxed text-foreground"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
        </Section>
      </CardContent>
    </Card>
  )
}
