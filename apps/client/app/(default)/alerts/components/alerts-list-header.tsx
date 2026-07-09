import { TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function AlertsListHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="w-8" />

        <TableHead className="w-28">Status</TableHead>

        <TableHead className="w-28">Timestamp</TableHead>

        <TableHead className="w-24">From</TableHead>

        <TableHead className="w-56">Name</TableHead>

        <TableHead className="min-w-0 max-w-sm">Description</TableHead>

        <TableHead className="md:table-cell">Location</TableHead>

        <TableHead className="w-28" />
      </TableRow>
    </TableHeader>
  )
}
