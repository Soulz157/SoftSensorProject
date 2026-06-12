export const NODE_STATUS_PRIORITY: Record<string, number> = {
  alarm: 0,
  warning: 1,
  offline: 2,
  normal: 3,
}
export const NODE_DOT: Record<string, string> = {
  alarm: 'bg-destructive',
  warning: 'bg-amber-500',
  offline: 'bg-zinc-400',
  normal: 'bg-green-500',
}
export const NODE_BADGE: Record<string, string> = {
  alarm: 'text-destructive',
  warning: 'text-amber-500',
  offline: 'text-muted-foreground',
  normal: 'text-green-500',
}

export const DEPLOY_PRIORITY: Record<string, number> = {
  error: 0,
  alert: 1,
  warning: 2,
  running: 3,
  stopped: 4,
  initializing: 5,
}
export const DEPLOY_DOT: Record<string, string> = {
  running: 'bg-green-500',
  initializing: 'bg-blue-400',
  stopped: 'bg-zinc-400',
  error: 'bg-red-500',
}
export const PROD_BADGE: Record<string, string> = {
  normal: 'text-green-500',
  warning: 'text-amber-400',
  alert: 'text-destructive',
  offline: 'text-muted-foreground',
}
