'use client'

import { ServerCog } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PiServer } from '@/lib/mock-pi-servers'

interface Props {
  servers: PiServer[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}

/**
 * Picks the PI server whose tags feed the model. Phase-6 mock exception: the
 * "servers connected to this workspace" link is cosmetic — `MOCK_PI_SERVERS`
 * is a single static server, not filtered by workspace yet.
 */
export function PiServerSelect({ servers, value, onChange, disabled }: Props) {
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a PI server" />
      </SelectTrigger>
      <SelectContent>
        {servers.map(server => (
          <SelectItem
            key={server.id}
            value={server.id}
            disabled={server.status === 'offline'}
          >
            <span className="flex items-center gap-2">
              <ServerCog className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-sm">{server.name}</span>
              <span className="text-xs text-muted-foreground">
                {server.host}
              </span>
              <span
                className={cn(
                  'ml-1 inline-flex items-center gap-1 text-xs font-medium',
                  server.status === 'online'
                    ? 'text-emerald-500'
                    : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    server.status === 'online'
                      ? 'bg-emerald-500'
                      : 'bg-muted-foreground',
                  )}
                />
                {server.status === 'online' ? 'Online' : 'Offline'}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
