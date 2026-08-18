'use client'

import { useState, useEffect } from 'react'
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
  ImagePlus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { useForm, Controller, useWatch } from 'react-hook-form'
import z from 'zod'
import { useCreateWorkspace } from '@/hooks/workspace/use-create-workspace'
import { zodResolver } from '@hookform/resolvers/zod'
import { cn } from '@/lib/utils'
import Image from 'next/image'

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

const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(100),
  industry: z.string().min(1, 'Please select an industry'),
  description: z.string().max(500).optional(),
  color: z.string(),
  icon: z.string(),
  thumbnail: z.any().optional(),
})

type CreateWorkspaceFormValues = z.infer<typeof createWorkspaceSchema>

interface CreateWorkspaceDialogProps {
  open: boolean
  onClose: () => void
}

export function CreateWorkspaceDialog({
  open,
  onClose,
}: CreateWorkspaceDialogProps) {
  const { createWorkspace } = useCreateWorkspace()
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>()

  const form = useForm<CreateWorkspaceFormValues>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: {
      name: '',
      color: 'blue',
      icon: 'building',
      industry: '',
      description: '',
      thumbnail: undefined,
    },
  })

  const watchedColor = useWatch({
    control: form.control,
    name: 'color',
    defaultValue: 'blue',
  })

  const watchedIcon = useWatch({
    control: form.control,
    name: 'icon',
    defaultValue: 'building',
  })

  useEffect(() => {
    return () => {
      if (thumbnailPreview) {
        URL.revokeObjectURL(thumbnailPreview)
      }
    }
  }, [thumbnailPreview])

  if (!open) return null

  const handleClose = () => {
    form.reset()
    setThumbnailPreview(null)
    onClose()
  }

  const onSubmit = async (values: CreateWorkspaceFormValues) => {
    await createWorkspace(values)
    handleClose()
  }

  const handleThumbnailChange = (file?: File) => {
    if (thumbnailPreview) {
      URL.revokeObjectURL(thumbnailPreview)
    }

    if (file) {
      const url = URL.createObjectURL(file)
      setThumbnailPreview(url)
      form.setValue('thumbnail', file, { shouldValidate: true })
    } else {
      setThumbnailPreview(null)
      form.setValue('thumbnail', undefined, { shouldValidate: true })
    }
  }

  const selectedColor =
    WORKSPACE_COLORS.find(c => c.id === watchedColor) ?? WORKSPACE_COLORS[0]!
  const selectedIcon =
    WORKSPACE_ICONS.find(i => i.id === watchedIcon) ?? WORKSPACE_ICONS[0]!
  const PreviewIcon = selectedIcon.Icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      <Card className="relative z-10 w-full max-w-md border-border bg-card p-6 shadow-lg overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200 overflow-hidden shrink-0',
                !thumbnailPreview && selectedColor.bg,
              )}
            >
              {thumbnailPreview ? (
                <Image
                  src={thumbnailPreview}
                  alt="Workspace Thumbnail"
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                />
              ) : (
                <PreviewIcon className="h-5 w-5 text-white" />
              )}
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
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Thumbnail{' '}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </Label>
            <div className="flex items-center gap-4">
              {thumbnailPreview ? (
                <div className="relative h-16 w-16 overflow-hidden rounded-md border border-input shrink-0 group">
                  <Image
                    src={thumbnailPreview}
                    alt="Preview"
                    width={128}
                    height={128}
                    className="h-full w-full object-cover"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      form.setValue('thumbnail', undefined)
                    }}
                    className="cursor-pointer absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    title="Remove thumbnail"
                  >
                    <Trash2 className="h-4 w-4 text-white" />
                  </Button>
                </div>
              ) : (
                <label className="flex h-16 w-16 cursor-pointer shrink-0 items-center justify-center rounded-md border border-dashed border-input bg-background transition-colors hover:border-primary/50 hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      handleThumbnailChange(file)
                    }}
                  />
                </label>
              )}
              <div className="text-xs text-muted-foreground">
                <p>Upload a workspace image.</p>
                <p>Max size: 5MB</p>
              </div>
            </div>
          </div>

          {/* ── Color + Icon row ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {/* Color Picker */}
            <div
              className={cn(
                'space-y-1.5 transition-opacity',
                thumbnailPreview && 'opacity-50 pointer-events-none',
              )}
            >
              <Label>Theme Color</Label>
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
            <div
              className={cn(
                'space-y-1.5 transition-opacity',
                thumbnailPreview && 'opacity-50 pointer-events-none',
              )}
            >
              <Label>Default Icon</Label>
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

          {/* ── Workspace Name ────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="workspaceName">Workspace Name</Label>
            <Input
              id="workspaceName"
              {...form.register('name')}
              placeholder="Enter workspace name"
              required
            />
          </div>

          {/* ── Industry ────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="industry">Industry</Label>
            <Controller
              control={form.control}
              name="industry"
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger id="industry" className="w-full">
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
          </div>

          {/* ── Description ─────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...form.register('description')}
              placeholder="Describe your workspace"
              rows={3}
              className="resize-none"
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
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">Create Workspace</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
