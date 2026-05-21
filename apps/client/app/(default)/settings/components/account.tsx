'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Pencil, X, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useProfile } from '@/hooks/user/use-profile'
import z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useUpdateProfile } from '@/hooks/user/use-update-profile'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const profileSchema = z.object({
  firstName: z.string().min(1, 'กรุณากรอกชื่อ'),
  lastName: z.string().min(1, 'กรุณากรอกนามสกุล'),
  company: z.string().optional(),
})

export function AccountTab() {
  const router = useRouter()
  const { profile, loading, refetch } = useProfile()
  const { updateProfile, isUpdating } = useUpdateProfile()
  const [isEditing, setIsEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: profile?.firstName || '',
      lastName: profile?.lastName || '',
      company: profile?.company || '',
    },
  })

  useEffect(() => {
    if (profile) {
      form.reset({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        company: profile.company || '',
      })
    }
  }, [profile, form])

  const cancelEdit = () => {
    form.reset()
    setIsEditing(false)
  }

  const handleSaveClick = form.handleSubmit(() => {
    setConfirmOpen(true)
  })

  const handleConfirmedSave = async () => {
    const result = await updateProfile(form.getValues())
    if (result.success) {
      if (refetch) await refetch()
      setIsEditing(false)
      setConfirmOpen(false)
      toast.success('อัปเดตข้อมูลสำเร็จ')
    } else {
      toast.error(result.error)
      setConfirmOpen(false)
    }
  }

  if (loading) {
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
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-16" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      </>
    )
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
                  {profile?.firstName && profile?.lastName
                    ? `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase()
                    : '?'}
                </span>
              </div>
              <button className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:bg-primary/80 transition-colors">
                <Camera className="h-3 w-3" />
              </button>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {profile?.firstName} {profile?.lastName}
              </p>
              <p className="text-xs text-muted-foreground">{profile?.email}</p>
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
                  value={form.watch('firstName')}
                  readOnly={!isEditing}
                  onChange={e =>
                    form.setValue('firstName', e.target.value, {
                      shouldDirty: true,
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
                  value={form.watch('lastName')}
                  readOnly={!isEditing}
                  onChange={e =>
                    form.setValue('lastName', e.target.value, {
                      shouldDirty: true,
                    })
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
                value={profile?.email}
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
                value={form.watch('company') ?? ''}
                placeholder="e.g. Acme Corporation"
                readOnly={!isEditing}
                onChange={e =>
                  form.setValue('company', e.target.value, {
                    shouldDirty: true,
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            To change your password, you will be redirected to the reset
            password page.
          </p>
          <Button
            variant="outline"
            onClick={() => router.push('/reset-password')}
          >
            Reset Password
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        {isEditing ? (
          <>
            <Button variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick} className="gap-2 min-w-32">
              {isUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
              {isUpdating ? 'Saving...' : 'Save Changes'}
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Save</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to update your profile information?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedSave}
              disabled={isUpdating}
            >
              {isUpdating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
