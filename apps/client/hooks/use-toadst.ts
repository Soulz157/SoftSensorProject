'use client'

import { toast as sonnerToast } from 'sonner'
import * as React from 'react'

type ToastProps = {
  id?: string | number
  title?: string | React.ReactNode
  description?: string | React.ReactNode
  variant?: 'default' | 'destructive'
  action?: {
    label: string
    onClick: () => void
  }
}

function toast({ title, description, variant, ...props }: ToastProps) {
  if (variant === 'destructive') {
    return sonnerToast.error(title, {
      description,
      ...props,
    })
  }

  return sonnerToast(title, {
    description,
    ...props,
  })
}

function useToast() {
  return {
    toast,
    dismiss: sonnerToast.dismiss,
  }
}

export { useToast, toast }
