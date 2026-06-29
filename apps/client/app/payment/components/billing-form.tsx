'use client'

import { useState, type ReactNode } from 'react'
import { CreditCard, QrCode } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function BillingForm({ email }: { email: string }) {
  const [method, setMethod] = useState<'card' | 'promptpay'>('card')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Billing details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Email">
            <Input
              value={email}
              readOnly
              disabled
              placeholder="you@company.com"
            />
          </Field>
          <Field label="Company name">
            <Input placeholder="Acme Inc." />
          </Field>
          <Field label="Tax ID">
            <Input placeholder="0000000000000" className="font-mono" />
          </Field>
          <Field label="Contact name">
            <Input placeholder="Jane Doe" />
          </Field>
          <Field label="Address">
            <Input placeholder="123 Main St, City" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Payment method
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="group"
            aria-label="Payment method"
            className="flex gap-1 rounded-lg bg-muted p-1"
          >
            {(
              [
                { id: 'card', label: 'Card', icon: CreditCard },
                { id: 'promptpay', label: 'PromptPay', icon: QrCode },
              ] as const
            ).map(opt => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={method === opt.id}
                  onClick={() => setMethod(opt.id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors',
                    method === opt.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                </button>
              )
            })}
          </div>

          {method === 'card' ? (
            <div className="space-y-4">
              <Field label="Card number">
                <Input
                  placeholder="1234 5678 9012 3456"
                  className="font-mono tracking-widest"
                />
              </Field>
              <div className="flex gap-4">
                <Field label="Expiry" className="flex-1">
                  <Input placeholder="MM / YY" className="font-mono" />
                </Field>
                <Field label="CVC" className="flex-1">
                  <Input placeholder="123" className="font-mono" />
                </Field>
              </div>
              <Field label="Name on card">
                <Input placeholder="JANE DOE" className="uppercase" />
              </Field>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <QrCode className="mx-auto mb-2 h-8 w-8 text-primary" />
              <p className="text-sm text-muted-foreground">
                A QR code will appear on the next step
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
