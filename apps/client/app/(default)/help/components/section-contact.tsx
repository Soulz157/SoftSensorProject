'use client'

import { Mail, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

const SUPPORT_EMAIL = 'support@softsensor.io'

export function SectionContact() {
  const handleCopy = () => {
    navigator.clipboard.writeText(SUPPORT_EMAIL).then(() => {
      toast.success('Email address copied to clipboard')
    })
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">
        Contact Support
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Our team responds to support requests within 24 hours on business days.
      </p>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary shrink-0">
            <Mail size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Email Support
            </p>
            <p className="text-sm text-muted-foreground">
              Response within 24 hours
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-3 mb-4">
          <span className="flex-1 text-sm font-medium text-foreground">
            {SUPPORT_EMAIL}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy size={13} className="mr-1" />
            Copy
          </Button>
        </div>

        <a href={`mailto:${SUPPORT_EMAIL}`}>
          <Button className="w-full gap-2">
            <ExternalLink size={14} />
            Open in Email Client
          </Button>
        </a>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        When contacting support, include your workspace name and a description
        of the issue. Screenshots are helpful.
      </p>
    </div>
  )
}
