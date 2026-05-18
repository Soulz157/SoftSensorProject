'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { AppLayout } from '@/components/app-layout'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Sun,
  Moon,
  Monitor,
  User,
  Building2,
  Check,
  Camera,
  Box,
  Cpu,
  Gauge,
  Thermometer,
  Activity,
  Globe,
  Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'theme' | 'account' | 'workspace'

const workspaceIcons = [
  { id: 'building', label: 'Building', icon: Building2 },
  { id: 'box', label: 'Box', icon: Box },
  { id: 'cpu', label: 'CPU', icon: Cpu },
  { id: 'gauge', label: 'Gauge', icon: Gauge },
  { id: 'thermometer', label: 'Thermometer', icon: Thermometer },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'shield', label: 'Shield', icon: Shield },
]

const workspaceColors = [
  { id: 'blue', bg: 'bg-blue-500' },
  { id: 'violet', bg: 'bg-violet-500' },
  { id: 'emerald', bg: 'bg-emerald-500' },
  { id: 'amber', bg: 'bg-amber-500' },
  { id: 'rose', bg: 'bg-rose-500' },
  { id: 'cyan', bg: 'bg-cyan-500' },
]

const initialWorkspaces = [
  { id: '1', name: 'Acme Corporation', icon: 'building', color: 'blue' },
  { id: '2', name: 'TechFlow Inc', icon: 'cpu', color: 'violet' },
  { id: '3', name: 'DataSense Ltd', icon: 'gauge', color: 'emerald' },
]

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [activeTab, setActiveTab] = useState<Tab>('theme')

  const [accountForm, setAccountForm] = useState({
    name: 'Jhon Doe',
    email: 'Jhondoe@gmail.com',
    password: '',
    confirmPassword: '',
  })
  const [accountSaved, setAccountSaved] = useState(false)

  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('1')
  const [workspaceSaved, setWorkspaceSaved] = useState(false)

  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)!

  const updateWorkspace = (field: string, value: string) => {
    setWorkspaces(prev =>
      prev.map(w =>
        w.id === selectedWorkspaceId ? { ...w, [field]: value } : w,
      ),
    )
    setWorkspaceSaved(false)
  }

  const saveAccount = () => {
    setAccountSaved(true)
    setTimeout(() => setAccountSaved(false), 2000)
  }

  const saveWorkspace = () => {
    setWorkspaceSaved(true)
    setTimeout(() => setWorkspaceSaved(false), 2000)
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'theme', label: 'Appearance', icon: <Sun className="h-4 w-4" /> },
    { id: 'account', label: 'Account', icon: <User className="h-4 w-4" /> },
    {
      id: 'workspace',
      label: 'Workspace',
      icon: <Building2 className="h-4 w-4" />,
    },
  ]

  const selectedColor =
    workspaceColors.find(c => c.id === selectedWorkspace.color)?.bg ??
    'bg-primary'
  const SelectedIcon =
    workspaceIcons.find(i => i.id === selectedWorkspace.icon)?.icon ?? Building2

  return (
    <AppLayout>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Settings sidebar nav */}
        <div className="w-52 border-r border-border bg-card shrink-0">
          <div className="p-4 border-b border-border">
            <h1 className="text-base font-semibold text-foreground">
              Settings
            </h1>
          </div>
          <nav className="p-2 space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content panel */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            {/* ── APPEARANCE ── */}
            {activeTab === 'theme' && (
              <>
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    Appearance
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose how SoftSensor looks for you.
                  </p>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Theme</CardTitle>
                    <CardDescription>
                      Select a color scheme for the interface.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { id: 'light', label: 'Light', icon: Sun },
                        { id: 'dark', label: 'Dark', icon: Moon },
                        { id: 'system', label: 'System', icon: Monitor },
                      ].map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          onClick={() => setTheme(id)}
                          className={cn(
                            'relative flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-all',
                            mounted && theme === id
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/50 hover:bg-accent/50',
                          )}
                        >
                          {mounted && theme === id && (
                            <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                              <Check className="h-2.5 w-2.5 text-primary-foreground" />
                            </span>
                          )}
                          {/* Mini preview window */}
                          <div
                            className={cn(
                              'w-full rounded-md border overflow-hidden',
                              id === 'light'
                                ? 'bg-white border-gray-200'
                                : id === 'dark'
                                  ? 'bg-gray-900 border-gray-700'
                                  : 'bg-linear-to-br from-white to-gray-900 border-gray-400',
                            )}
                          >
                            <div
                              className={cn(
                                'h-3 border-b flex items-center gap-1 px-1.5',
                                id === 'light'
                                  ? 'bg-gray-100 border-gray-200'
                                  : id === 'dark'
                                    ? 'bg-gray-800 border-gray-700'
                                    : 'bg-gray-500 border-gray-400',
                              )}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            </div>
                            <div className="p-1.5 flex gap-1">
                              <div
                                className={cn(
                                  'w-6 rounded h-6',
                                  id === 'light'
                                    ? 'bg-gray-200'
                                    : id === 'dark'
                                      ? 'bg-gray-700'
                                      : 'bg-gray-500',
                                )}
                              />
                              <div className="flex-1 space-y-1 pt-0.5">
                                <div
                                  className={cn(
                                    'h-1.5 rounded',
                                    id === 'light'
                                      ? 'bg-gray-200'
                                      : id === 'dark'
                                        ? 'bg-gray-600'
                                        : 'bg-gray-500',
                                  )}
                                />
                                <div
                                  className={cn(
                                    'h-1.5 rounded w-2/3',
                                    id === 'light'
                                      ? 'bg-gray-100'
                                      : id === 'dark'
                                        ? 'bg-gray-700'
                                        : 'bg-gray-600',
                                  )}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-foreground">
                              {label}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ── ACCOUNT ── */}
            {activeTab === 'account' && (
              <>
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    Account
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Manage your personal information and security.
                  </p>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">
                      Profile
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-xl font-semibold text-primary">
                            {accountForm.name.charAt(0)}
                          </span>
                        </div>
                        <button className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:bg-primary/80 transition-colors">
                          <Camera className="h-3 w-3" />
                        </button>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {accountForm.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {accountForm.email}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          Full Name
                        </label>
                        <input
                          className={inputClass}
                          value={accountForm.name}
                          onChange={e =>
                            setAccountForm({
                              ...accountForm,
                              name: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          Email
                        </label>
                        <input
                          className={inputClass}
                          type="email"
                          value={accountForm.email}
                          onChange={e =>
                            setAccountForm({
                              ...accountForm,
                              email: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">
                      Change Password
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        New Password
                      </label>
                      <input
                        className={inputClass}
                        type="password"
                        placeholder="••••••••"
                        value={accountForm.password}
                        onChange={e =>
                          setAccountForm({
                            ...accountForm,
                            password: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        Confirm Password
                      </label>
                      <input
                        className={inputClass}
                        type="password"
                        placeholder="••••••••"
                        value={accountForm.confirmPassword}
                        onChange={e =>
                          setAccountForm({
                            ...accountForm,
                            confirmPassword: e.target.value,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button onClick={saveAccount} className="gap-2 min-w-32">
                    {accountSaved && <Check className="h-4 w-4" />}
                    {accountSaved ? 'Saved!' : 'Save Changes'}
                  </Button>
                </div>
              </>
            )}

            {/* ── WORKSPACE ── */}
            {activeTab === 'workspace' && (
              <>
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    Workspace
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Customize the name and appearance of each workspace.
                  </p>
                </div>

                {/* Workspace selector */}
                <div className="grid grid-cols-3 gap-2">
                  {workspaces.map(w => (
                    <button
                      key={w.id}
                      onClick={() => {
                        setSelectedWorkspaceId(w.id)
                        setWorkspaceSaved(false)
                      }}
                      className={cn(
                        'rounded-lg border-2 p-3 text-left transition-all',
                        selectedWorkspaceId === w.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50',
                      )}
                    >
                      <p className="text-xs font-medium text-foreground truncate">
                        {w.name}
                      </p>
                    </button>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">
                      Workspace Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Preview */}
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          'h-14 w-14 rounded-xl flex items-center justify-center shadow',
                          selectedColor,
                        )}
                      >
                        <SelectedIcon className="h-7 w-7 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {selectedWorkspace.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Workspace icon preview
                        </p>
                      </div>
                    </div>

                    {/* Name */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        Workspace Name
                      </label>
                      <input
                        className={inputClass}
                        value={selectedWorkspace.name}
                        onChange={e => updateWorkspace('name', e.target.value)}
                      />
                    </div>

                    {/* Icon picker */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Icon
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {workspaceIcons.map(({ id, label, icon: Icon }) => (
                          <button
                            key={id}
                            title={label}
                            onClick={() => updateWorkspace('icon', id)}
                            className={cn(
                              'h-9 w-9 rounded-md border-2 flex items-center justify-center transition-all',
                              selectedWorkspace.icon === id
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Color picker */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Color
                      </label>
                      <div className="flex gap-2">
                        {workspaceColors.map(({ id, bg }) => (
                          <button
                            key={id}
                            onClick={() => updateWorkspace('color', id)}
                            className={cn(
                              'h-8 w-8 rounded-full transition-all',
                              bg,
                              selectedWorkspace.color === id
                                ? 'ring-2 ring-offset-2 ring-foreground scale-110'
                                : 'hover:scale-105 opacity-70 hover:opacity-100',
                            )}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Image upload */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        Or Upload Custom Image
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer w-fit rounded-md border border-dashed border-border px-4 py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                        <Camera className="h-4 w-4" />
                        Choose Image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                        />
                      </label>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG up to 2 MB
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button onClick={saveWorkspace} className="gap-2 min-w-32">
                    {workspaceSaved && <Check className="h-4 w-4" />}
                    {workspaceSaved ? 'Saved!' : 'Save Changes'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
