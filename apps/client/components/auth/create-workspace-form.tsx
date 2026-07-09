'use client'

import { useState, useEffect } from 'react'
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
  ImagePlus,
  Trash2,
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useCreateWorkspace } from '@/hooks/workspace/use-create-workspace'
import z from 'zod'
import { useForm, Controller } from 'react-hook-form'
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
  industry: z.string().min(1, { message: 'Please select an industry' }),
  description: z.string().max(500).optional(),
  icon: z.string().min(1),
  color: z.string().min(1),
  thumbnail: z.any().optional(),
})

type WorkspaceFormValues = z.infer<typeof workspaceSchema>

export function CreateWorkspaceForm() {
  const { createWorkspace, isCreating } = useCreateWorkspace()
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const router = useRouter()

  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: {
      name: '',
      industry: '',
      description: '',
      icon: 'building',
      color: 'blue',
      thumbnail: undefined,
    },
  })

  const watchedThumbnail = form.watch('thumbnail')
  const watchedColor = form.watch('color')
  const watchedIcon = form.watch('icon')

  const selectedColor =
    WORKSPACE_COLORS.find(c => c.id === watchedColor) ?? WORKSPACE_COLORS[0]!
  const selectedIcon =
    WORKSPACE_ICONS.find(i => i.id === watchedIcon) ?? WORKSPACE_ICONS[0]!
  const PreviewIcon = selectedIcon.Icon

  useEffect(() => {
    if (watchedThumbnail && watchedThumbnail instanceof File) {
      const objectUrl = URL.createObjectURL(watchedThumbnail)
      setThumbnailPreview(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    }
    setThumbnailPreview(null)
  }, [watchedThumbnail])

  const onSubmit = async (values: WorkspaceFormValues) => {
    const result = await createWorkspace(values)
    if (result.success) {
      toast.success('Workspace created', {
        description: 'You can now create models and start monitoring!',
      })
      router.push('/overview')
    } else {
      toast.error('Failed to create workspace')
    }
  }

  return (
    <Card className="w-full max-w-lg bg-card/80 backdrop-blur-md shadow-2xl">
      {/* ── Header + Live Preview ── */}
      <CardHeader className="pb-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl overflow-hidden shadow-sm transition-colors duration-200',
              !thumbnailPreview && selectedColor.bg,
            )}
          >
            {thumbnailPreview ? (
              <img
                src={thumbnailPreview}
                alt="Workspace Thumbnail"
                className="h-full w-full object-cover"
              />
            ) : (
              <PreviewIcon className="h-6 w-6 text-white" />
            )}
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">Create workspace</CardTitle>
            <CardDescription className="text-xs">
              Set up your first workspace
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="space-y-5 max-h-[70vh] overflow-y-auto px-6 pb-6 custom-scrollbar">
          {/* ── Thumbnail Upload ── */}
          <div className="space-y-2">
            <Label>
              Thumbnail{' '}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </Label>
            <div className="flex items-center gap-4">
              {thumbnailPreview ? (
                <div className="relative h-14 w-14 overflow-hidden rounded-md border border-input shrink-0 group">
                  <img
                    src={thumbnailPreview}
                    alt="Preview"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => form.setValue('thumbnail', undefined)}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    title="Remove thumbnail"
                  >
                    <Trash2 className="h-4 w-4 text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex h-14 w-14 cursor-pointer shrink-0 items-center justify-center rounded-md border border-dashed border-input bg-background transition-colors hover:border-primary/50 hover:bg-accent">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) form.setValue('thumbnail', file)
                    }}
                  />
                </label>
              )}
              <div className="text-xs text-muted-foreground leading-tight">
                <p>Upload a workspace image.</p>
                <p>Max size: 5MB</p>
              </div>
            </div>
          </div>

          {/* ── Workspace Name ── */}
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              placeholder="e.g. Acme Corporation"
              {...form.register('name')}
              className="bg-background"
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* ── Industry ── */}
          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <Controller
              control={form.control}
              name="industry"
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger id="industry" className="w-full bg-background">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manufacturing">Manufacturing</SelectItem>
                    <SelectItem value="technology">Technology</SelectItem>
                    <SelectItem value="healthcare">Healthcare</SelectItem>
                    <SelectItem value="energy">Energy</SelectItem>
                    <SelectItem value="logistics">Logistics</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.industry && (
              <p className="text-xs text-destructive">
                {form.formState.errors.industry.message}
              </p>
            )}
          </div>

          {/* ── Description ── */}
          <div className="space-y-2">
            <Label htmlFor="description">
              Description{' '}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </Label>
            <Textarea
              id="description"
              placeholder="Briefly describe your workspace"
              rows={2}
              className="resize-none bg-background"
              {...form.register('description')}
            />
          </div>

          {/* ── Icon Picker ── */}
          <div
            className={cn(
              'space-y-2 transition-opacity',
              thumbnailPreview && 'opacity-50 pointer-events-none',
            )}
          >
            <Label>Icon</Label>
            <Controller
              control={form.control}
              name="icon"
              render={({ field }) => (
                <div className="grid grid-cols-4 gap-2">
                  {WORKSPACE_ICONS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      title={label}
                      onClick={() => field.onChange(id)}
                      className={cn(
                        'flex h-10 w-full items-center justify-center rounded-md border transition-colors',
                        field.value === id
                          ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                          : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          {/* ── Color Picker ── */}
          <div
            className={cn(
              'space-y-2 transition-opacity',
              thumbnailPreview && 'opacity-50 pointer-events-none',
            )}
          >
            <Label>Theme Color</Label>
            <Controller
              control={form.control}
              name="color"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2">
                  {WORKSPACE_COLORS.map(({ id, bg }) => (
                    <button
                      key={id}
                      type="button"
                      title={id}
                      onClick={() => field.onChange(id)}
                      className={cn(
                        'relative h-7 w-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                        bg,
                        field.value === id &&
                          'ring-2 ring-offset-2 ring-offset-card scale-110',
                      )}
                    >
                      {field.value === id && (
                        <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          <Button type="submit" className="w-full mt-4" disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isCreating ? 'Creating...' : 'Create workspace'}
          </Button>
        </CardContent>
      </form>
    </Card>
  )
}
