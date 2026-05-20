'use client'
import { AppLayout } from '@/components/app-layout'

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <AppLayout>{children}</AppLayout>
}
