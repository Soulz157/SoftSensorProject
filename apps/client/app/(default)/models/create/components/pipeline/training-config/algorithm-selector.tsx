'use client'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALGORITHMS,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'

interface Props {
  algorithm: Algorithm
  onChange: (algorithm: Algorithm) => void
}

/** Model algorithm dropdown. Changing it swaps the dynamic hyperparameter grid. */
export function AlgorithmSelector({ algorithm, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">Algorithm</Label>
      <Select value={algorithm} onValueChange={v => onChange(v as Algorithm)}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALGORITHMS.map(a => (
            <SelectItem key={a} value={a}>
              {ALGORITHM_LABELS[a]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
