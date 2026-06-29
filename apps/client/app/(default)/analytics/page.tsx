import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { AnalyticsDashboard } from './components/analytics-dashboard'

export default function AnalyticsAllPage() {
  return (
    <div className="flex-1 space-y-4 overflow-auto p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Data Integration (All Workspaces)</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <AnalyticsDashboard workspaceId="all" />
    </div>
  )
}
