'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActivityLogTable } from '@/app/admin/activity/components/activity-log-table'
import { UserStatsTable } from '@/app/admin/activity/components/user-stats-table'

export function ActivityPageClient() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Activity Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor authentication activity and per-user login counts.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ActivityLogTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              User Stats (7 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <UserStatsTable />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
