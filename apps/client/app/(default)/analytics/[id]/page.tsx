import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { AnalyticsDashboard } from '../components/analytics-dashboard'

export default async function AnalyticsPage({
  params,
}: {
  params: { id: string }
}) {
  const { id } = await params
  return (
    <div className="flex-1 space-y-4 overflow-auto p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Data Integration</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <AnalyticsDashboard workspaceId={id} />
    </div>
  )
}
