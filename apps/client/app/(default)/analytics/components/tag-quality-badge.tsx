import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CirclePause,
  CircleX,
  type LucideIcon,
} from 'lucide-react'
import { TAG_QUALITY_LABEL } from '@/lib/data-intake'
import type { TagQuality } from '@/types/data-intake'
import { cn } from '@/lib/utils'

export const TAG_QUALITY_ICON: Record<TagQuality, LucideIcon> = {
  good: CircleCheck,
  questionable: CircleHelp,
  bad: CircleX,
  noReading: CircleDashed,
  notLive: CirclePause,
}

/** Icon + label, always both. Colour is deliberately neutral: this is arrival
 *  quality of a tag, not workspace or plant status, so red/amber stay reserved
 *  for those. `Bad` is set apart by weight. */
export function TagQualityBadge({ quality }: { quality: TagQuality }) {
  const Icon = TAG_QUALITY_ICON[quality]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        quality === 'bad'
          ? 'font-medium text-foreground'
          : 'text-muted-foreground',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {TAG_QUALITY_LABEL[quality]}
    </span>
  )
}
