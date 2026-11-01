import { notFound } from 'next/navigation'
import { MonitoringMockupToggle } from './monitoring-mockup-toggle'

/** Dev-only switch for the ModelTest 1 Monitoring mockup. Nothing links here. */
export default function MonitoringMockupPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <MonitoringMockupToggle />
}
