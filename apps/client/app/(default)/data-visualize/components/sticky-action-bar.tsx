'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onNext: () => void
  onBack: () => void
  backDisabled: boolean
  nextDisabled: boolean
  nextLabel: string
}

export function StickyActionBar({
  onNext,
  onBack,
  backDisabled,
  nextDisabled,
  nextLabel,
}: Props) {
  return (
    <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between border-t border-border bg-background/95 px-6 py-4 backdrop-blur-sm">
      <Button variant="outline" onClick={onBack} disabled={backDisabled}>
        <ChevronLeft className="h-4 w-4" />
        Back
      </Button>
      <Button onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
