import { Suspense } from 'react'
import { WizardShell } from './components/wizard-shell'

export default function CreateDatasetPage() {
  return (
    <div className="flex h-full overflow-hidden">
      <Suspense fallback={null}>
        <WizardShell />
      </Suspense>
    </div>
  )
}
