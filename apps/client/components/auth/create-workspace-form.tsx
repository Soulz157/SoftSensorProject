'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2,
  Box,
  Cpu,
  Gauge,
  Thermometer,
  Activity,
  Globe,
  Shield,
  Loader2,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useCreateWorkspace } from '@/hooks/workspace/use-create-workspace'
import z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

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
const workspaceSchema = z.object({
  name: z.string().min(1, { message: 'Workspace name is required' }),
  icon: z.string().min(1),
  color: z.string().min(1),
})

export function CreateWorkspaceForm() {
  const { createWorkspace, isCreating } = useCreateWorkspace()
  const [icon, setIcon] = useState('building')
  const [color, setColor] = useState('blue')
  const router = useRouter()
  type WorkspaceFormValues = z.infer<typeof workspaceSchema>

  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: {
      name: '',
      icon: 'building',
      color: 'blue',
    },
  })

  const onSubmit = async (values: WorkspaceFormValues) => {
    const result = await createWorkspace(values)
    if (result.success) {
      toast.success('Workspace created', {
        description: 'You can now create models and start monitoring!',
      })
      router.push('/dashboard')
    }
  }

  return (
    <Card className="w-full max-w-sm bg-card/80 backdrop-blur-md shadow-2xl">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Create workspace</CardTitle>
        <CardDescription>
          Set up your first workspace to get started
        </CardDescription>
      </CardHeader>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              placeholder="e.g. Acme Corporation"
              {...form.register('name')}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="grid grid-cols-4 gap-2">
              {WORKSPACE_ICONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => setIcon(id)}
                  className={cn(
                    'flex h-10 w-full items-center justify-center rounded-md border transition-colors',
                    icon === id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex gap-2">
              {WORKSPACE_COLORS.map(({ id, bg }) => (
                <button
                  key={id}
                  type="button"
                  title={id}
                  onClick={() => setColor(id)}
                  className={cn(
                    'relative h-7 w-7 rounded-full transition-transform hover:scale-110',
                    bg,
                  )}
                >
                  {color === id && (
                    <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create workspace
          </Button>
        </CardContent>
      </form>
    </Card>
  )
}
