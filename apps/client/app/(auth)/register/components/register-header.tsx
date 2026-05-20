import { Activity } from 'lucide-react'
import Link from 'next/link'

export function RegisterHeader() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
        <Link href="/ ">
          <Activity className="h-6 w-6 text-primary-foreground" />
        </Link>
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          Create your account
        </h1>
        <p className="mt-1 text-muted-foreground">
          Get started with SoftSensor today
        </p>
      </div>
    </div>
  )
}
