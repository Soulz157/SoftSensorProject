import { Activity } from 'lucide-react'

export function LoginHeader() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
        <Activity className="h-6 w-6 text-primary-foreground" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
        <p className="mt-1 text-muted-foreground">
          Sign in to your SoftSensor account
        </p>
      </div>
    </div>
  )
}
