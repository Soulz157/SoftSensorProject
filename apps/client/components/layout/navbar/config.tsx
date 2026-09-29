// components/layout/navbar/config.tsx

// MODEL-SERVE-022-T08. The mock `notifications` array and
// `getNotificationIcon` that used to live here were removed — the navbar
// bell (`navbar-notification.tsx`) now reads real events from
// `useNotifications` (hooks/notifications/use-notifications.ts), per D10.

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
