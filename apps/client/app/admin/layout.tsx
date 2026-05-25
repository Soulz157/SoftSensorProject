import { AdminAppLayout } from '@/components/admin/app-layout'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminAppLayout>{children}</AdminAppLayout>
}
