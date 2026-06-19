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
// Text roles use darker shades in light mode to pass WCAG AA 4.5:1 on light
// surfaces; bright shades return in dark mode. Dots (NODE_DOT) stay bright.
export const NODE_BADGE: Record<string, string> = {
  alarm: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  offline: 'text-muted-foreground',
  normal: 'text-green-700 dark:text-green-400',
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
  normal: 'text-green-700 dark:text-green-400',
  warning: 'text-amber-700 dark:text-amber-400',
  alert: 'text-destructive',
  offline: 'text-muted-foreground',
  frozen: 'text-purple-600 dark:text-purple-400',
}

// Production status dot colors (parallels DEPLOY_DOT for monitoring state).
export const PROD_DOT: Record<string, string> = {
  normal: 'bg-green-500',
  warning: 'bg-amber-500',
  alert: 'bg-destructive',
  offline: 'bg-zinc-400',
  frozen: 'bg-purple-500',
}
