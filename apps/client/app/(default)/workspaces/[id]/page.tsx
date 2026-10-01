import { redirect } from 'next/navigation'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // MODEL-SERVE-025. The workspace canvas was removed; a bare workspace URL
  // opens its plant overview, the sidebar's own "Overview" entry.
  redirect(`/plants/${id}`)
}
