import { Suspense } from 'react'
import { WizardShell } from './components/wizard-shell'
import { DatasetTagSidebar } from './components/dataset-tag-sidebar'

export default function CreateDatasetPage() {
  return (
    <div className="flex h-full overflow-hidden">
      <DatasetTagSidebar />
      <Suspense fallback={null}>
        <WizardShell />
      </Suspense>
    </div>
  )
}
