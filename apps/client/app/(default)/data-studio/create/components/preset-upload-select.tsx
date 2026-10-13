'use client'

import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PresetUpload } from '@/services/feature-preset'

interface Props {
  /** The signed-in user's own uploads, newest first. */
  uploads: PresetUpload[]
  /** The upload whose presets the manager currently shows. */
  selectedId: string | null
  onSelect: (id: string) => void
  /** True while an upload's presets are loading. */
  disabled?: boolean
}

function meta(upload: PresetUpload): string {
  const count = `${upload.presetCount} preset${upload.presetCount === 1 ? '' : 's'}`
  return [
    format(new Date(upload.createdAt), 'd MMM yyyy, HH:mm'),
    count,
    upload.hasSdta ? 'SD&TA' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * "Your workbook": the signed-in user's own uploads as one compact select -
 * the same h-8 control as the Unit / Configuration pickers beside it, so it
 * costs a single row instead of a list.
 *
 * Only the user's uploads (user decision 2026-10-12): teammates' workbooks made
 * the choice hard to read. `Latest` marks the user's newest upload, which the
 * manager opens on; it is the server's flag, never inferred from dates here.
 * The badge is the default (non-status) badge - DESIGN.md reserves status hues
 * for operating state.
 *
 * The trigger shows only the file name and badge; the date and preset count
 * appear in the open list. `SelectValue`'s own children replace the item text
 * in the trigger, so `components/ui/select` stays untouched.
 *
 * Hidden when the user has no uploads here - the manager then shows the
 * workspace's latest template and there is nothing of theirs to pick.
 */
export function PresetUploadSelect({
  uploads,
  selectedId,
  onSelect,
  disabled = false,
}: Props) {
  if (uploads.length === 0) return null

  // A teammate's upload can be on screen (the workspace-latest fallback);
  // then nothing here is selected and the placeholder says what to do.
  const selected = uploads.find(u => u.id === selectedId) ?? null

  return (
    <div className="min-w-0 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        Your workbook
      </span>
      <Select
        value={selected?.id ?? ''}
        onValueChange={id => {
          if (id !== selected?.id) onSelect(id)
        }}
        disabled={disabled}
      >
        <SelectTrigger
          className="h-8 w-full text-xs"
          aria-label="Your workbook"
        >
          <SelectValue placeholder="Choose one of your uploads…">
            {selected && (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono">{selected.fileName}</span>
                {selected.isLatest && <Badge>Latest</Badge>}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {uploads.map(upload => (
            <SelectItem key={upload.id} value={upload.id} className="text-xs">
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono">{upload.fileName}</span>
                  {upload.isLatest && <Badge>Latest</Badge>}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {meta(upload)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
