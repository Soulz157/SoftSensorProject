import { email } from 'zod'
import { RegisterPayload } from '@/types'
import { fetchClient } from '@/lib/fetcher'

export const authService = {
  register: (data: RegisterPayload) =>
    fetchClient('/api/v1/public/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  forgotPassword: (email: string) =>
    fetchClient('/api/v1/public/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (data: { email: string; token: string; password: string }) =>
    fetchClient('/api/v1/public/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    fetchClient('/api/v1/authorized/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  async logout() {
    return fetchClient('/api/v1/authorized/auth/logout', {
      method: 'POST',
    })
  },
}
