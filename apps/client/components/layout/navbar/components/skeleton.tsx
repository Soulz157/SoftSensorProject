export function NavbarSkeleton() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-pulse rounded-md bg-muted lg:hidden" />
        <div className="h-9 w-9 animate-pulse rounded-md bg-muted sm:hidden" />
      </div>
      <div
        className="hidden flex-1 items-center gap-4 sm:flex"
        style={{ maxWidth: '28rem' }}
      >
        <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-9 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
      </div>
    </header>
  )
}
