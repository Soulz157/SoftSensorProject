import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { EvalMetrics } from '@/lib/model-evaluation'

const fmt = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export function EvaluationMetrics({ metrics }: { metrics: EvalMetrics }) {
  const biasLabel =
    metrics.bias < -0.05
      ? 'Under-predicts'
      : metrics.bias > 0.05
        ? 'Over-predicts'
        : 'Balanced'

  const items = [
    {
      label: 'RMSE',
      value: fmt(metrics.rmse),
      hint: 'Root mean squared error',
    },
    { label: 'MAE', value: fmt(metrics.mae), hint: 'Mean absolute error' },
    {
      label: 'R²',
      value: metrics.r2.toFixed(3),
      hint: 'Coefficient of determination',
      accent:
        metrics.r2 >= 0.85
          ? 'text-emerald-500'
          : metrics.r2 >= 0.7
            ? 'text-amber-500'
            : 'text-red-500',
    },
    {
      label: 'Bias',
      value: `${metrics.bias >= 0 ? '+' : ''}${fmt(metrics.bias)}`,
      hint: biasLabel,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(item => (
        <Card key={item.label} className="border-border bg-card">
          <CardContent className="pt-5">
            <p className="text-xs font-medium text-muted-foreground">
              {item.label}
            </p>
            <p
              className={cn(
                'mt-1 text-2xl font-semibold tabular-nums text-foreground',
                item.accent,
              )}
            >
              {item.value}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {item.hint}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
