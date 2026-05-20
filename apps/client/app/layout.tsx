import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { cn } from '@/lib/utils'
import { AppProviders } from '@/components/providers/session-provider'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export const metadata: Metadata = {
  title: 'SoftSensor — Smart Monitoring Platform',
  description:
    'Professional soft sensor monitoring and AI model management platform for industrial data analytics.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(geistSans.variable, geistMono.variable, 'font-sans')}
    >
      <body className={cn(geistSans.variable, geistMono.variable, 'font-sans')}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
