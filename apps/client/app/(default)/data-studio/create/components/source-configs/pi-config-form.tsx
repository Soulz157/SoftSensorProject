'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PIConfig } from '@/store/model-pipeline'

interface Props {
  config: PIConfig
  onChange: (config: PIConfig) => void
  disabled?: boolean
}

export function PIConfigForm({ config, onChange, disabled }: Props) {
  const set = <K extends keyof PIConfig>(key: K, value: PIConfig[K]) =>
    onChange({ ...config, [key]: value })

  const { piServerUrl, calcType, calcBasis, intervalTime, userName, password } =
    config

  return (
    <div className="space-y-2.5">
      <div className="grid gap-1.5">
        <Label className="text-xs">PI Server URL</Label>
        <Input
          readOnly
          disabled={disabled}
          className="h-7 cursor-default border-transparent bg-muted/50 font-mono text-xs text-muted-foreground shadow-none focus-visible:ring-0"
          placeholder="https://pi-server/piwebapi"
          value={piServerUrl}
        />
      </div>
      <div className="flex justify-between gap-2">
        <div className="grid gap-1.5 w-full">
          <Label className="text-xs">User</Label>
          <Input
            readOnly
            disabled={disabled}
            className="h-7 cursor-default border-transparent bg-muted/50 font-mono text-xs text-muted-foreground shadow-none focus-visible:ring-0"
            placeholder="username"
            value={userName ?? ''}
          />
        </div>
        <div className="grid gap-1.5 w-full">
          <Label className="text-xs">Password</Label>
          <Input
            readOnly
            disabled={disabled}
            className="h-7 cursor-default border-transparent bg-muted/50 font-mono text-xs text-muted-foreground shadow-none focus-visible:ring-0"
            placeholder="********"
            value={password ?? ''}
          />
        </div>
      </div>
      <div className="my-1 h-px bg-border" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">Calc Type</Label>
          <Select
            value={calcType}
            disabled={disabled}
            onValueChange={v => set('calcType', v as PIConfig['calcType'])}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Average">Average</SelectItem>
              <SelectItem value="Interpolated">Interpolated</SelectItem>
              <SelectItem value="Recorded">Recorded</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Calc Basis</Label>
          <Select
            value={calcBasis}
            disabled={disabled}
            onValueChange={v => set('calcBasis', v as PIConfig['calcBasis'])}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TimeWeighted">TimeWeighted</SelectItem>
              <SelectItem value="EventWeighted">EventWeighted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Interval</Label>
          <Input
            className="h-7 font-mono text-xs"
            placeholder="1m"
            value={intervalTime}
            disabled={disabled}
            onChange={e => set('intervalTime', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
