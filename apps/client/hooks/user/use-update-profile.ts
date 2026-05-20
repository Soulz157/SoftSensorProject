import { useState } from 'react'
import { profileService } from '@/services/profile'
import { UpdateProfilePayload } from '@/types'

export function useUpdateProfile() {
  const [isUpdating, setIsUpdating] = useState(false)

  const updateProfile = async (data: UpdateProfilePayload) => {
    setIsUpdating(true)
    try {
      await profileService.updateProfile(data)
      return { success: true }
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message }
      }
      return { success: false, error: 'An unknown error occurred' }
    } finally {
      setIsUpdating(false)
    }
  }

  return { updateProfile, isUpdating }
}
