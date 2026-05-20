'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor, Check } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold text-foreground">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how SoftSensor looks for you.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Theme</CardTitle>
          <CardDescription>
            Select a color scheme for the interface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[
              { id: 'light', label: 'Light', icon: Sun },
              { id: 'dark', label: 'Dark', icon: Moon },
              { id: 'system', label: 'System', icon: Monitor },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                suppressHydrationWarning
                className={cn(
                  'relative flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-all',
                  mounted && theme === id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-accent/50',
                )}
              >
                {mounted && theme === id && (
                  <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </span>
                )}
                {/* Mini preview window */}
                <div
                  className={cn(
                    'w-full rounded-md border overflow-hidden',
                    id === 'light'
                      ? 'bg-white border-gray-200'
                      : id === 'dark'
                        ? 'bg-gray-900 border-gray-700'
                        : 'bg-linear-to-br from-white to-gray-900 border-gray-400',
                  )}
                >
                  <div
                    className={cn(
                      'h-3 border-b flex items-center gap-1 px-1.5',
                      id === 'light'
                        ? 'bg-gray-100 border-gray-200'
                        : id === 'dark'
                          ? 'bg-gray-800 border-gray-700'
                          : 'bg-gray-500 border-gray-400',
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="p-1.5 flex gap-1">
                    <div
                      className={cn(
                        'w-6 rounded h-6',
                        id === 'light'
                          ? 'bg-gray-200'
                          : id === 'dark'
                            ? 'bg-gray-700'
                            : 'bg-gray-500',
                      )}
                    />
                    <div className="flex-1 space-y-1 pt-0.5">
                      <div
                        className={cn(
                          'h-1.5 rounded',
                          id === 'light'
                            ? 'bg-gray-200'
                            : id === 'dark'
                              ? 'bg-gray-600'
                              : 'bg-gray-500',
                        )}
                      />
                      <div
                        className={cn(
                          'h-1.5 rounded w-2/3',
                          id === 'light'
                            ? 'bg-gray-100'
                            : id === 'dark'
                              ? 'bg-gray-700'
                              : 'bg-gray-600',
                        )}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground">
                    {label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
