// components/layout/navbar/config.tsx
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { NotificationItem } from './types'

export const notifications: NotificationItem[] = [
  {
    id: '1',
    type: 'alert',
    title: 'Model Alert',
    message: 'Vibration Anomaly Detector accuracy dropped below threshold',
    workspace: 'Acme Corporation',
    time: '2 min ago',
    read: false,
  },
  {
    id: '2',
    type: 'warning',
    title: 'High Memory Usage',
    message: 'Temperature Predictor using 89% memory',
    workspace: 'Smart Factory Alpha',
    time: '15 min ago',
    read: false,
  },
  {
    id: '3',
    type: 'success',
    title: 'Deployment Complete',
    message: 'Quality Inspector v2.1 deployed successfully',
    workspace: 'Energy Grid Monitor',
    time: '1 hour ago',
    read: true,
  },
  {
    id: '4',
    type: 'info',
    title: 'Scheduled Maintenance',
    message: 'System maintenance scheduled for tonight 2:00 AM',
    workspace: 'System',
    time: '3 hours ago',
    read: true,
  },
]

export const searchSuggestions = {
  workspaces: [
    { id: '1', name: 'Acme Corporation', type: 'workspace' },
    { id: '2', name: 'Smart Factory Alpha', type: 'workspace' },
  ],
  models: [
    {
      id: '1',
      name: 'Vibration Anomaly Detector',
      workspace: 'Acme Corporation',
      type: 'model',
    },
    {
      id: '2',
      name: 'Temperature Predictor',
      workspace: 'Smart Factory Alpha',
      type: 'model',
    },
  ],
  nodes: [
    {
      id: '1',
      name: 'CNC Machine A1',
      workspace: 'Acme Corporation',
      type: 'node',
    },
    {
      id: '2',
      name: 'Assembly Robot B2',
      workspace: 'Smart Factory Alpha',
      type: 'node',
    },
  ],
}

export const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'alert':
      return <AlertCircle className="h-4 w-4 text-red-500" />
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    default:
      return <Clock className="h-4 w-4 text-blue-500" />
  }
}
