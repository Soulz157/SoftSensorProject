export default function DashboardLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-3 border-b border-border bg-[#0a0d14] px-4 py-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/30" />
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted/20" />
        <div className="h-6 w-36 animate-pulse rounded-full bg-muted/20" />
      </div>
      <div className="flex flex-1">
        <div className="w-40 shrink-0 space-y-2 border-r border-border bg-[#0a0d14] p-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded-md bg-muted/30" />
              <div className="flex-1 space-y-1">
                <div className="h-2.5 animate-pulse rounded bg-muted/30" />
                <div className="h-2 w-2/3 animate-pulse rounded bg-muted/20" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 animate-pulse bg-[#080a0f]" />
        <div className="w-50 shrink-0 border-l border-border bg-[#0a0d14]" />
      </div>
      ``
    </div>
  )
}
