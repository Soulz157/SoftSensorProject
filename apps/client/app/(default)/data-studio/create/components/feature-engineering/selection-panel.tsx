'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Props {
  allColumns: string[]
  engineeredColumns: string[]
  selectedColumns: string[] | null
  setSelectedColumns: (columns: string[] | null) => void
}

/** Feature Selection — keep/drop each column (original + engineered). */
export function SelectionPanel({
  allColumns,
  engineeredColumns,
  selectedColumns,
  setSelectedColumns,
}: Props) {
  const isSelected = (col: string) =>
    selectedColumns === null || selectedColumns.includes(col)

  const selectedCount =
    selectedColumns === null ? allColumns.length : selectedColumns.length

  const toggle = (col: string, checked: boolean) => {
    const current = selectedColumns ?? [...allColumns]
    const next = checked
      ? [...new Set([...current, col])]
      : current.filter(c => c !== col)
    // Collapse to `null` (keep-all) when every column is selected.
    setSelectedColumns(next.length === allColumns.length ? null : next)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-sm">Feature Selection</CardTitle>
          <CardDescription>
            Choose which columns are kept in the final dataset.
          </CardDescription>
        </div>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {selectedCount} / {allColumns.length} selected
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedColumns(null)}
            disabled={selectedCount === allColumns.length}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedColumns([])}
            disabled={selectedCount === 0}
          >
            Clear
          </Button>
        </div>

        {allColumns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No columns yet — fetch data and add features first.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Keep</TableHead>
                  <TableHead>Column</TableHead>
                  <TableHead className="w-32">Origin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allColumns.map(col => {
                  const engineered = engineeredColumns.includes(col)
                  return (
                    <TableRow key={col}>
                      <TableCell>
                        <Checkbox
                          checked={isSelected(col)}
                          onCheckedChange={c => toggle(col, c === true)}
                          aria-label={`Keep ${col}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{col}</TableCell>
                      <TableCell>
                        <Badge variant={engineered ? 'outline' : 'ghost'}>
                          {engineered ? 'Engineered' : 'Original'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
