import { RegisterPayload } from '@/types'
import { fetchClient } from '@/lib/fetcher'

export const authService = {
  register: (data: RegisterPayload) =>
    fetchClient('/api/v1/public/auth/register', {
      method: 'POST',
      // headers: {
      //   'Content-Type': 'application/json',
      // },
      body: JSON.stringify(data),
    }),

  async logout() {
    return fetchClient('/api/v1/authorized/auth/logout', {
      method: 'POST',
    })
  },
}
