export const dynamic = 'force-dynamic'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { AnalyticsDashboard } from '@/app/(default)/analytics/components/analytics-dashboard'

/** The all-workspaces view is admin-only; the admin layout guards it. A
 *  single workspace's view stays at `/analytics/[id]` (Data Intake). */
export default function AdminAnalyticsPage() {
  return (
    <div className="flex-1 overflow-auto p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Data Intake (All Workspaces)</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <AnalyticsDashboard workspaceId="all" />
      </div>
    </div>
  )
}
