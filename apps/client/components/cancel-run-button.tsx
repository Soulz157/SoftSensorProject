'use client'

import { Loader2, X } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const COPY = {
  training: {
    title: 'Cancel training?',
    body: 'The container running now is stopped and the work it has done is thrown away. Anything that already finished is kept. You can start again from Step 3.',
    confirm: 'Cancel training',
  },
  retrain: {
    title: 'Cancel retrain?',
    body: 'The container running now is stopped and the work it has done is thrown away. No new version is staged, and the current version is not touched. You can start another retrain afterwards.',
    confirm: 'Cancel retrain',
  },
} as const

interface Props {
  /** What is being stopped — decides the wording of the confirmation. */
  subject: keyof typeof COPY
  /** Runs once the user confirms. Nothing is stopped before that. */
  onConfirm: () => void
  /** The cancel request is in flight. */
  canceling: boolean
  className?: string
}

/**
 * A run that has been going for tens of minutes is thrown away by one click,
 * so Cancel asks first. Used by Step 3 (a training run or job) and by the
 * model page's Retrain tab; the two differ only in what the dialog promises.
 *
 * Button variants follow the design system (§ Button variants): the trigger and
 * "Keep running" are `outline` (secondary action); the confirm is
 * `destructive` (irreversible). They are set through the `variant` prop the
 * AlertDialog buttons already take — never by stacking a variant's classes on
 * a button that is already wrapped in a default one. Declining changes nothing.
 */
export function CancelRunButton({
  subject,
  onConfirm,
  canceling,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const copy = COPY[subject]

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={canceling}
        onClick={() => setOpen(true)}
        className={cn('cursor-pointer gap-2', className)}
      >
        {canceling ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <X className="h-4 w-4" />
        )}
        {canceling ? 'Canceling…' : 'Cancel'}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">
              Keep running
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirm}>
              {copy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
