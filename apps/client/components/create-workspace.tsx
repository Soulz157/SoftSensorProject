'use client'

import {
  X,
  Building2,
  Cpu,
  Check,
  Box,
  Gauge,
  Thermometer,
  Globe,
  Activity,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useForm, Controller } from 'react-hook-form'
import z from 'zod'
import { useCreateWorkspace } from '@/hooks/workspace/use-create-workspace'
import { zodResolver } from '@hookform/resolvers/zod'
import { cn } from '@/lib/utils'

const WORKSPACE_ICONS = [
  { id: 'building', label: 'Building', Icon: Building2 },
  { id: 'box', label: 'Box', Icon: Box },
  { id: 'cpu', label: 'CPU', Icon: Cpu },
  { id: 'gauge', label: 'Gauge', Icon: Gauge },
  { id: 'thermometer', label: 'Thermometer', Icon: Thermometer },
  { id: 'activity', label: 'Activity', Icon: Activity },
  { id: 'globe', label: 'Globe', Icon: Globe },
  { id: 'shield', label: 'Shield', Icon: Shield },
]

const WORKSPACE_COLORS = [
  { id: 'blue', bg: 'bg-blue-500' },
  { id: 'violet', bg: 'bg-violet-500' },
  { id: 'emerald', bg: 'bg-emerald-500' },
  { id: 'amber', bg: 'bg-amber-500' },
  { id: 'rose', bg: 'bg-rose-500' },
  { id: 'cyan', bg: 'bg-cyan-500' },
]
// ─── Schema ─────────────────────────────────────────────────────────────────

const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(100),
  industry: z.string().min(1, 'Please select an industry'),
  description: z.string().max(500).optional(),
  color: z.string(),
  icon: z.string(),
})

type CreateWorkspaceFormValues = z.infer<typeof createWorkspaceSchema>

// ─── Props ───────────────────────────────────────────────────────────────────

interface CreateWorkspaceDialogProps {
  open: boolean
  onClose: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CreateWorkspaceDialog({
  open,
  onClose,
}: CreateWorkspaceDialogProps) {
  const { createWorkspace } = useCreateWorkspace()

  const form = useForm<CreateWorkspaceFormValues>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: {
      name: '',
      color: 'blue',
      icon: 'building',
      industry: '',
      description: '',
    },
  })

  if (!open) return null

  const handleClose = () => {
    form.reset()
    onClose()
  }

  const onSubmit = async (values: CreateWorkspaceFormValues) => {
    await createWorkspace(values)
    handleClose()
  }

  const watchedColor = form.watch('color')
  const watchedIcon = form.watch('icon')

  const selectedColor =
    WORKSPACE_COLORS.find(c => c.id === watchedColor) ?? WORKSPACE_COLORS[0]!
  const selectedIcon =
    WORKSPACE_ICONS.find(i => i.id === watchedIcon) ?? WORKSPACE_ICONS[0]!
  const PreviewIcon = selectedIcon.Icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <Card className="relative z-10 w-full max-w-md border-border bg-card p-6 shadow-lg">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {/* Live preview of chosen color + icon */}
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200',
                selectedColor.bg,
              )}
            >
              <PreviewIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Create Workspace
              </h2>
              <p className="text-xs text-muted-foreground">
                Add a new company workspace
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* ── Color + Icon row ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {/* Color Picker */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Color
              </label>
              <Controller
                control={form.control}
                name="color"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {WORKSPACE_COLORS.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.id}
                        onClick={() => field.onChange(c.id)}
                        className={cn(
                          'relative h-7 w-7 rounded-full transition-all duration-150 focus:outline-none',
                          c.bg,
                          field.value === c.id
                            ? `ring-2 ring-offset-2 ring-offset-card ${c.bg} scale-110`
                            : 'hover:scale-105',
                        )}
                      >
                        {field.value === c.id && (
                          <Check className="absolute inset-0 m-auto h-3 w-3 text-white" />
                        )}
                        <span className="sr-only">{c.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              />
            </div>

            {/* Icon Picker */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Icon
              </label>
              <Controller
                control={form.control}
                name="icon"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {WORKSPACE_ICONS.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        title={label}
                        onClick={() => field.onChange(id)}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-md border transition-all duration-150 focus:outline-none',
                          field.value === id
                            ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                            : 'border-input bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="sr-only">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              />
            </div>
          </div>

          {/* ── Company Name ────────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Company Name
            </label>
            <input
              type="text"
              {...form.register('name')}
              placeholder="Enter company name"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          {/* ── Industry ────────────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Industry
            </label>
            <select
              {...form.register('industry')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select industry</option>
              <option value="manufacturing">Manufacturing</option>
              <option value="technology">Technology</option>
              <option value="healthcare">Healthcare</option>
              <option value="energy">Energy</option>
              <option value="logistics">Logistics</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* ── Description ─────────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Description
            </label>
            <textarea
              {...form.register('description')}
              placeholder="Describe your workspace"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* ── Info banner ─────────────────────────────────────────────── */}
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              Each workspace can contain up to{' '}
              <span className="font-medium text-foreground">100 models</span>.
              You can import models after creating the workspace.
            </p>
          </div>

          {/* ── Actions ─────────────────────────────────────────────────── */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create Workspace</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
