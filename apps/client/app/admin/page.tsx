import { redirect } from 'next/navigation'

// The admin home is /admin/dashboard — the old "System Overview" was folded
// into it (workspace table, search and recent activity live there now).
export default function AdminPage() {
  redirect('/admin/dashboard')
}
