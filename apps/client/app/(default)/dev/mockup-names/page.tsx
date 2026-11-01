import { notFound } from 'next/navigation'
import { MockupNamesToggle } from './mockup-names-toggle'

/** Dev-only switch for document mockup mode. Nothing links here. */
export default function MockupNamesPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <MockupNamesToggle />
}
