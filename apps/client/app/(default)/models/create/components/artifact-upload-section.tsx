'use client'

import { useRef, useState } from 'react'
import { FileArchive, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  ARTIFACT_EXTENSIONS,
  hasArtifactExtension,
  formatBytes,
} from '@/lib/mock-model-create'

interface Props {
  artifact: File | null
  disabled: boolean
  onSelect: (file: File | null) => void
}

export function ArtifactUploadSection({ artifact, disabled, onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function accept(file: File | undefined) {
    if (!file) return
    if (!hasArtifactExtension(file.name)) {
      toast.error(`Unsupported file. Use ${ARTIFACT_EXTENSIONS.join(', ')}`)
      return
    }
    onSelect(file)
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ARTIFACT_EXTENSIONS.join(',')}
        className="hidden"
        onChange={e => accept(e.target.files?.[0])}
      />

      {artifact ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <FileArchive className="h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {artifact.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(artifact.size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={disabled}
            onClick={() => {
              onSelect(null)
              if (inputRef.current) inputRef.current.value = ''
            }}
            aria-label="Remove file"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 transition-colors',
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50',
            disabled && 'pointer-events-none opacity-60',
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault()
            setDragOver(false)
            accept(e.dataTransfer.files?.[0])
          }}
        >
          <UploadCloud
            className={cn(
              'h-7 w-7 transition-colors',
              dragOver ? 'text-primary' : 'text-muted-foreground',
            )}
          />
          <p className="text-sm text-muted-foreground">
            {dragOver
              ? 'Drop to attach'
              : 'Click or drag a model artifact here'}
          </p>
          <p className="text-[11px] text-muted-foreground/60">
            {ARTIFACT_EXTENSIONS.join(', ')} · max 200 MB
          </p>
        </button>
      )}
    </div>
  )
}
