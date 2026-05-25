import { atomWithStorage } from 'jotai/utils'

export const adminSidebarCollapsedAtom = atomWithStorage(
  'admin-sidebar-collapsed',
  false,
)
