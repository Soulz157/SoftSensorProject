import { Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

/** Shown in place of a monitoring tab for a VIEWER an OWNER has not granted
 *  MONITORING_VIEW — neutral, not an error: nothing is broken. */
export function MonitoringAccessNotice() {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          Monitoring access needed
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Viewers see this model&apos;s monitoring once a workspace owner grants
          Model monitoring in Settings → Members → Manage access.
        </p>
      </CardContent>
    </Card>
  )
}
