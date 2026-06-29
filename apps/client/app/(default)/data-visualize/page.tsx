'use client'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { WizardShell } from './components/wizard-shell'

export default function DataVisualizePage() {
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="space-y-4 p-6 pb-0">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Data Visualization</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Data Visualization
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Workspace → PI server → tags → fetch → preprocess → export (mock
            data pending live ingestion)
          </p>
        </div>
      </div>

      <WizardShell />
    </div>
  )
}
