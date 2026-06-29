import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  title: string
  description: string
  done?: boolean
}

const STEPS: Step[] = [
  {
    title: 'Create a Workspace',
    description:
      'Click + New Workspace on the dashboard. Give it a name, icon, and color tag. Workspaces group related nodes and models together.',
  },
  {
    title: 'Open the Canvas',
    description:
      'Navigate to your workspace and click Canvas in the sidebar. Switch to Build Mode using the toggle in the top-right toolbar.',
  },
  {
    title: 'Add Your First Node',
    description:
      'Click + Add Node, choose a type (Machine, Sensor, or Controller), then set its status. Nodes represent physical devices in your facility.',
  },
  {
    title: 'Monitor Alerts',
    description:
      'The Alerts page lists all nodes in Warning or Alarm state. The sidebar badge pulses when active alerts exist.',
    done: true,
  },
]

export function SectionQuickStart() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">
        Quick Start Guide
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Get up and running with SoftSensor in under 10 minutes.
      </p>

      <div className="flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="flex gap-4 items-start bg-card border border-border rounded-xl p-4"
          >
            <div
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold shrink-0',
                step.done
                  ? 'bg-emerald-500 text-white'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              {step.done ? <Check size={14} /> : i + 1}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground mb-0.5">
                {step.title}
              </p>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
