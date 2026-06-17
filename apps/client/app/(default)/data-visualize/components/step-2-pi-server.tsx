'use client'

import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { ServerCog, RotateCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getDefaultPiServer } from '@/lib/mock-pi-servers'
import { piServerIdAtom } from '@/store/data-visualize'

export function Step2PiServer() {
  const server = getDefaultPiServer()
  const setPiServerId = useSetAtom(piServerIdAtom)

  useEffect(() => {
    if (server.status === 'online') setPiServerId(server.id)
  }, [server, setPiServerId])

  if (server.status === 'offline') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t reach the PI server</AlertTitle>
        <AlertDescription>Try again.</AlertDescription>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-fit"
          onClick={() => setPiServerId(server.id)}
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </Alert>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerCog className="h-4 w-4" />
          PI server
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <div>
          <p className="font-mono text-sm">{server.name}</p>
          <p className="text-xs text-muted-foreground">{server.host}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Online
        </span>
      </CardContent>
    </Card>
  )
}
