'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  backLabel: string
  nextLabel: string
  onBack: () => void
  onNext: () => void
  nextDisabled?: boolean
}

export function ProcessingActionFooter({
  backLabel,
  nextLabel,
  onBack,
  onNext,
  nextDisabled,
}: Props) {
  return (
    <div className="flex items-center justify-between border-t border-border/60 pt-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        {backLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onNext}
        disabled={nextDisabled}
        className="gap-1"
      >
        {nextLabel}
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
