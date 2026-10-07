import { redirect } from 'next/navigation'

/** The all-workspaces view moved to the Admin Panel; the admin layout sends
 *  non-admins to `/`. Kept so old links still resolve. */
export default function AnalyticsAllPage() {
  redirect('/admin/analytics')
}
