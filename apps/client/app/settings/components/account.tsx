'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Camera, Pencil, X, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

export function AccountTab() {
  const { data: session } = useSession()
  const [accountForm, setAccountForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    company: '',
    password: '',
    confirmPassword: '',
  })
  const [accountSaved, setAccountSaved] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (session?.user) {
      setAccountForm(prev => ({
        ...prev,
        firstName: session.user.firstName ?? '',
        lastName: session.user.lastName ?? '',
        email: session.user.email ?? '',
      }))
    }
  }, [session?.user])

  const cancelEdit = () => {
    setIsEditing(false)
    if (session?.user) {
      setAccountForm(prev => ({
        ...prev,
        firstName: session.user.firstName ?? '',
        lastName: session.user.lastName ?? '',
        password: '',
        confirmPassword: '',
      }))
    }
  }

  const saveAccount = () => {
    setAccountSaved(true)
    setTimeout(() => {
      setAccountSaved(false)
      setIsEditing(false)
    }, 1500)
  }

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold text-foreground">Account</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your personal information and security.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Profile</CardTitle>
          {isEditing ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={cancelEdit}
              className="h-8 w-8 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsEditing(true)}
              className="h-8 w-8 text-muted-foreground"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-xl font-semibold text-primary">
                  {(
                    accountForm.firstName.charAt(0) +
                    accountForm.lastName.charAt(0)
                  ).toUpperCase() || '?'}
                </span>
              </div>
              <button className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:bg-primary/80 transition-colors">
                <Camera className="h-3 w-3" />
              </button>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {accountForm.firstName} {accountForm.lastName}
              </p>
              <p className="text-xs text-muted-foreground">
                {accountForm.email}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  First Name
                </label>
                <input
                  className={cn(
                    inputClass,
                    !isEditing && 'opacity-60 cursor-default',
                  )}
                  value={accountForm.firstName}
                  readOnly={!isEditing}
                  onChange={e =>
                    setAccountForm({
                      ...accountForm,
                      firstName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Last Name
                </label>
                <input
                  className={cn(
                    inputClass,
                    !isEditing && 'opacity-60 cursor-default',
                  )}
                  value={accountForm.lastName}
                  readOnly={!isEditing}
                  onChange={e =>
                    setAccountForm({ ...accountForm, lastName: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                className={inputClass}
                type="email"
                value={accountForm.email}
                readOnly
                disabled
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Company
              </label>
              <input
                className={cn(
                  inputClass,
                  !isEditing && 'opacity-60 cursor-default',
                )}
                value={accountForm.company}
                placeholder="e.g. Acme Corporation"
                readOnly={!isEditing}
                onChange={e =>
                  setAccountForm({ ...accountForm, company: e.target.value })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              New Password
            </label>
            <input
              className={inputClass}
              type="password"
              placeholder="••••••••"
              value={accountForm.password}
              onChange={e =>
                setAccountForm({ ...accountForm, password: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Confirm Password
            </label>
            <input
              className={inputClass}
              type="password"
              placeholder="••••••••"
              value={accountForm.confirmPassword}
              onChange={e =>
                setAccountForm({
                  ...accountForm,
                  confirmPassword: e.target.value,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        {isEditing ? (
          <>
            <Button variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button onClick={saveAccount} className="gap-2 min-w-32">
              {accountSaved && <Check className="h-4 w-4" />}
              {accountSaved ? 'Saved!' : 'Save Changes'}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            onClick={() => setIsEditing(true)}
            className="gap-2"
          >
            <Pencil className="h-4 w-4" />
            Edit Profile
          </Button>
        )}
      </div>
    </>
  )
}
