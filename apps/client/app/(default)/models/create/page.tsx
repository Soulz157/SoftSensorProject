import { Suspense } from 'react'
import { CreateModelForm } from './components/create-model-form'

export default function CreateModelPage() {
  return (
    <div className="flex h-full overflow-hidden">
      <Suspense fallback={null}>
        <CreateModelForm />
      </Suspense>
    </div>
  )
}
