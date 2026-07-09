// components/tag-mini-chart.tsx
import { Bar, BarChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import type { FlatRow, TagStatRow } from '@/hooks/use-tag-stats'

interface TooltipPayloadItem {
  value: number | null
  payload: FlatRow
}

interface RawDataTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function RawDataTooltip({ active, payload }: RawDataTooltipProps) {
  if (!active || !payload?.length) return null

  const item = payload[0]
  if (!item) return null

  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      {item.payload.timestamp && (
        <p className="mb-1 text-[10px] text-muted-foreground">
          {new Date(item.payload.timestamp).toLocaleString()}
        </p>
      )}
      <div className="flex items-center gap-2 font-mono text-sm">
        <span className="text-muted-foreground">Value:</span>
        <span className="font-medium text-foreground">
          {item.value != null ? fmt(item.value) : 'N/A'}
        </span>
      </div>
    </div>
  )
}

interface Props {
  stat: TagStatRow
  flatRows: FlatRow[]
  isSelected: boolean
  onSelect: (tag: string) => void
}

export function TagMiniChart({ stat, flatRows, isSelected, onSelect }: Props) {
  const chartConfig: ChartConfig = {
    [stat.tag]: { label: 'Value', color: stat.fill },
  }

  return (
    <div
      onClick={() => onSelect(stat.tag)}
      className={[
        'flex cursor-pointer flex-col space-y-3 rounded-lg border p-4 shadow-sm',
        'transition-shadow hover:shadow-md',
        isSelected ? 'ring-2 ring-ring' : '',
      ].join(' ')}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: stat.fill }}
          />
          <span className="font-mono text-sm font-semibold text-foreground">
            {stat.tag}
          </span>
        </div>

        <div
          className="flex items-center gap-3 font-mono text-[10px]
                        uppercase text-muted-foreground"
        >
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-chart-1" />
            Mean: {fmt(stat.mean)}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-muted-foreground" />
            Median: {fmt(stat.median)}
          </span>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="h-45 w-full">
        <BarChart
          data={flatRows}
          margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
        >
          <XAxis
            dataKey="timestamp"
            tick={false}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
            domain={['auto', 'auto']}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
            content={<RawDataTooltip />}
          />
          <Bar
            dataKey={stat.tag}
            fill={stat.fill}
            radius={[2, 2, 0, 0]}
            opacity={0.6}
            isAnimationActive={false}
          />
          <ReferenceLine
            y={stat.mean}
            stroke="red"
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
          <ReferenceLine
            y={stat.median}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            strokeWidth={1.5}
            opacity={0.7}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}
