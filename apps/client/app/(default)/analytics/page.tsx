'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Activity,
  TrendingUp,
  Database,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

const sensorData = [
  { time: '00:00', temp: 62, vibration: 45, pressure: 78 },
  { time: '02:00', temp: 58, vibration: 42, pressure: 80 },
  { time: '04:00', temp: 55, vibration: 38, pressure: 76 },
  { time: '06:00', temp: 60, vibration: 50, pressure: 82 },
  { time: '08:00', temp: 71, vibration: 63, pressure: 88 },
  { time: '10:00', temp: 78, vibration: 72, pressure: 91 },
  { time: '12:00', temp: 85, vibration: 80, pressure: 95 },
  { time: '14:00', temp: 88, vibration: 84, pressure: 93 },
  { time: '16:00', temp: 82, vibration: 76, pressure: 89 },
  { time: '18:00', temp: 75, vibration: 68, pressure: 85 },
  { time: '20:00', temp: 69, vibration: 58, pressure: 81 },
  { time: '22:00', temp: 64, vibration: 50, pressure: 79 },
]

const modelAccuracy = [
  { name: 'Temp Predictor', accuracy: 94.2 },
  { name: 'Demand Forecaster', accuracy: 91.8 },
  { name: 'Quality Classifier', accuracy: 96.1 },
  { name: 'Anomaly Detector', accuracy: 87.5 },
  { name: 'Load Balancer AI', accuracy: 97.2 },
  { name: 'Traffic Analyzer', accuracy: 95.1 },
  { name: 'Compression AI', accuracy: 94.8 },
]

const weeklyPredictions = [
  { day: 'Mon', predictions: 4200, errors: 38 },
  { day: 'Tue', predictions: 5100, errors: 52 },
  { day: 'Wed', predictions: 4800, errors: 29 },
  { day: 'Thu', predictions: 5600, errors: 41 },
  { day: 'Fri', predictions: 6200, errors: 63 },
  { day: 'Sat', predictions: 3400, errors: 22 },
  { day: 'Sun', predictions: 2900, errors: 18 },
]

const nodeStatusData = [
  { name: 'Online', value: 14, color: '#10b981' },
  { name: 'Warning', value: 3, color: '#f59e0b' },
  { name: 'Offline', value: 2, color: '#ef4444' },
]

const workspaceUsage = [
  { workspace: 'Acme Corp', models: 24, nodes: 6, dataPoints: 8.4 },
  { workspace: 'TechFlow Inc', models: 56, nodes: 3, dataPoints: 15.2 },
  { workspace: 'DataSense Ltd', models: 12, nodes: 2, dataPoints: 4.1 },
]

const timeRanges = ['24h', '7d', '30d', '90d'] as const
type TimeRange = (typeof timeRanges)[number]

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')

  const kpis = [
    {
      label: 'Total Data Points',
      value: '27.7M',
      delta: '+12.4%',
      positive: true,
      icon: <Database className="h-8 w-8 text-primary" />,
    },
    {
      label: 'Avg Model Accuracy',
      value: '93.8%',
      delta: '+1.2%',
      positive: true,
      icon: <TrendingUp className="h-8 w-8 text-emerald-500" />,
    },
    {
      label: 'System Uptime',
      value: '99.7%',
      delta: '-0.1%',
      positive: false,
      icon: <Activity className="h-8 w-8 text-amber-500" />,
    },
    {
      label: 'Active Nodes',
      value: '14 / 19',
      delta: '+2 nodes',
      positive: true,
      icon: <Cpu className="h-8 w-8 text-muted-foreground" />,
    },
  ]

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time performance metrics across all workspaces
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {timeRanges.map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  timeRange === r
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="bg-card border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                {kpi.icon}
              </div>
              <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
              <p
                className={`text-xs mt-1 font-medium ${
                  kpi.positive ? 'text-emerald-500' : 'text-red-500'
                }`}
              >
                {kpi.delta} vs last period
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Sensor Readings Area Chart */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              Sensor Readings (24h)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Temperature · Vibration · Pressure
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={sensorData}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradVib" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradPres" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="time"
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <YAxis
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Area
                  type="monotone"
                  dataKey="temp"
                  name="Temp (°C)"
                  stroke="#6366f1"
                  fill="url(#gradTemp)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="vibration"
                  name="Vibration"
                  stroke="#10b981"
                  fill="url(#gradVib)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="pressure"
                  name="Pressure"
                  stroke="#f59e0b"
                  fill="url(#gradPres)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Node Status Pie */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Node Status</CardTitle>
            <p className="text-xs text-muted-foreground">19 total nodes</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={nodeStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {nodeStatusData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 mt-1">
              {nodeStatusData.map(d => (
                <div
                  key={d.name}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="text-muted-foreground">{d.name}</span>
                  </div>
                  <span className="font-medium text-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Model Accuracy Bar Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              Model Accuracy
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Current accuracy per model (%)
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={modelAccuracy}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[80, 100]}
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={110}
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={value => [`${value}%`, 'Accuracy']}
                />
                <Bar dataKey="accuracy" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Weekly Predictions Line Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              Weekly Predictions
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Prediction volume vs errors this week
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={weeklyPredictions}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="day"
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{
                    fontSize: 10,
                    fill: 'hsl(var(--muted-foreground))',
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="predictions"
                  name="Predictions"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="errors"
                  name="Errors"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Workspace Usage Table */}
      <Card className="bg-card border-border mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            Workspace Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {[
                    'Workspace',
                    'Models',
                    'Nodes',
                    'Data Points (M)',
                    'Health',
                  ].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workspaceUsage.map(w => (
                  <tr
                    key={w.workspace}
                    className="hover:bg-accent/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {w.workspace}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {w.models}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {w.nodes}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {w.dataPoints}M
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{
                              width: `${Math.round((w.models / 60) * 100)}%`,
                            }}
                          />
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Model Status Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <div>
                <p className="text-sm text-muted-foreground">Running</p>
                <p className="text-3xl font-bold text-emerald-500">8</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: '67%' }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              67% of all models
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <XCircle className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Stopped</p>
                <p className="text-3xl font-bold text-foreground">3</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-muted-foreground rounded-full"
                style={{ width: '25%' }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              25% of all models
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <div>
                <p className="text-sm text-muted-foreground">Errors</p>
                <p className="text-3xl font-bold text-amber-500">1</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: '8%' }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              8% of all models
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
