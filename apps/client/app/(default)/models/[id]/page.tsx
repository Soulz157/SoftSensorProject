'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAtomValue } from 'jotai'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Activity,
  ArrowLeft,
  ArrowUpCircle,
  BarChart3,
  Box,
  CheckCircle2,
  Cpu,
  Database,
  Gauge,
  History,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Snowflake,
  StopCircle,
  Terminal,
  User,
  Waves,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { workspacesAtom } from '@/store/workspace'
import { getModels } from '@/services/model'
import { inferenceWindowService } from '@/services/inference-window'
import { useRefreshModels } from '@/hooks/use-all-models'
import { monitoringStatusFromHealth } from '@/lib/model-status'
// MODEL-SERVE-012. The SHARED label map, not a local copy. This page used to
// keep its own duplicate of it; a copied map is free to drift from its
// original the moment either side adds a code — which is exactly what
// happened when the residual-SD codes were added to one and not the other.
// One map, three readers (this page, the Alerts page, and anything that
// renders a reason next).
import { HEALTH_REASON_LABEL } from '@/lib/health-status-style'
import { ALGORITHM_LABELS } from '@/store/model-pipeline'
import { formatMetricValue } from '@/lib/model-evaluation'
import type { AIModel } from '@/types'
import { ModelEvaluation } from '../evaluation/components/model-evaluation'
import { ModelUpsertDialog } from '../views/components/model-upsert-dialog'
import { ModelRetrainDialog } from './components/model-retrain-dialog'
import { RetrainProgress } from './components/retrain-progress'
import { InputDataTab } from './components/input-data-tab'
import { ModelMonitoringTab } from './components/monitoring/model-monitoring-tab'
import { WindowLogsTab } from './components/window-logs-tab'
import { useModelRetrain } from '@/hooks/model/use-model-retrain'
import { useModelPromote } from '@/hooks/model/use-model-promote'
import { useModelInputSchema } from '@/hooks/model/use-model-input-schema'
import { useInferenceStatus } from '@/hooks/model/use-inference-status'
import { useRunPredict } from '@/hooks/model/use-run-predict'
import LoadingModelPage from './loading'
import ErrorModelPage from './error'

const DEPLOY_CONFIG = {
  running: {
    icon: CheckCircle2,
    cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    label: 'Running',
  },
  stopped: {
    icon: StopCircle,
    cls: 'bg-muted text-muted-foreground border-border',
    label: 'Offline',
  },
  error: {
    icon: XCircle,
    cls: 'bg-red-500/10 text-red-500 border-red-500/20',
    label: 'Failed',
  },
  initializing: {
    icon: RefreshCw,
    cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    label: 'Initializing',
  },
} as const

/**
 * MODEL-SERVE-012. Now the MONITORING badge's palette, not a manual
 * production-status one: `monitoringStatus` derives these five words from
 * the measured health axis. The colours are unchanged — the vocabulary and
 * its meanings are the same five states, only their source moved.
 */
const PROD_CONFIG = {
  normal: {
    icon: Activity,
    cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    label: 'Normal',
  },
  warning: {
    icon: Activity,
    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    label: 'Warning',
  },
  alert: {
    icon: XCircle,
    cls: 'bg-red-500/10 text-red-500 border-red-500/20',
    label: 'Alert',
  },
  offline: {
    icon: WifiOff,
    cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    label: 'Offline',
  },
  frozen: {
    icon: Snowflake,
    cls: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400',
    label: 'Data Frozen',
  },
} as const

export default function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const workspaces = useAtomValue(workspacesAtom)
  const [model, setModel] = useState<AIModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [isToggling, setIsToggling] = useState(false)
  const [confirmDeploy, setConfirmDeploy] = useState<
    'running' | 'stopped' | null
  >(null)
  const [editOpen, setEditOpen] = useState(false)
  const [retrainOpen, setRetrainOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [monitoringKey, setMonitoringKey] = useState(0)
  const refresh = () => setVersion(v => v + 1)
  const retrain = useModelRetrain({ model, onUpdated: refresh })
  const refreshModels = useRefreshModels()
  const [overrideReason, setOverrideReason] = useState('')

  /**
   * MODEL-SERVE-001-T04/T06. Promotion is the step between a saved model and
   * a deployable one, and until now the ONLY place in the client that could
   * take it was the create wizard's final screen — so a model whose deploy
   * failed there (or that was saved without deploying) had no way forward at
   * all. `input-schema` already resolves PRODUCTION first and falls back to
   * the newest version, so the stage it reports is exactly what decides
   * whether there is anything to promote.
   */
  const { schema: versionSchema } = useModelInputSchema(model?.id ?? null)
  const promote = useModelPromote(() => {
    setOverrideReason('')
    refresh()
    refreshModels()
    // MODEL-SERVE-014. The retrain result card reads the job's own
    // comparison, where the promoted version is still STAGING until re-read
    // — without this it would keep offering "Apply to Production" for a
    // version that is already live.
    retrain.refresh()
  })
  const canPromote = !!versionSchema && versionSchema.stage !== 'PRODUCTION'

  /**
   * MODEL-SERVE-001-T09. The word AND its reason, from one payload — never
   * a second state machine. `status` is null only until the first read
   * resolves (or the model has no id yet); `model.data?.deployStatus`
   * below is the fallback for that window alone, same classifier, an
   * older fetch.
   */
  const {
    status: inferenceStatus,
    error: inferenceStatusError,
    refetch: refetchInferenceStatus,
  } = useInferenceStatus(model?.id ?? null)
  const deployStatusReady = inferenceStatus !== null

  /**
   * MODEL-SERVE-011-T06. The SAME refresh trio `handleToggleDeploy` runs —
   * the new window has to reach the Monitoring and Logs tabs, the header
   * badges, and the sidebar/Alerts counts that read `useAllModels`. A
   * queued run is not visible anywhere until these land.
   */
  const runPredict = useRunPredict(() => {
    refreshModels()
    refresh()
    refetchInferenceStatus()
    // MODEL-SERVE-011-T08. The live point lives in the Monitoring tab's own
    // series, which is cached by model id and range alone — without this it
    // would not reappear until the user changed the range.
    setMonitoringKey(k => k + 1)
  })

  /**
   * MODEL-SERVE-006-T12/MODEL-SERVE-001-T09. deployStatus is DERIVED now —
   * this toggle changes what actually drives it (the model's
   * InferenceSchedule), not the status label itself. "Stop" disables the
   * schedule; "Start" enables it, which requires a PRODUCTION version to
   * exist (the backend refuses otherwise, surfaced here as the existing
   * generic failure toast).
   *
   * NO optimistic `deployStatus` write here anymore — it used to assert
   * `running` right where the classifier would actually say
   * `initializing` (a freshly enabled schedule has no windows yet BY
   * CONSTRUCTION), a second source of truth disagreeing with the first.
   * ONE refetch after the mutation resolves proves it landed; it does not
   * and cannot prove the source works, which the card's own wording says
   * instead of a guess. `refreshModels()` stays — the sidebar dot, Alerts
   * badge, and models/views list all read the same `useAllModels` atoms.
   */
  async function handleToggleDeploy(next: 'running' | 'stopped') {
    if (!model) return
    setIsToggling(true)
    try {
      await inferenceWindowService.putSchedule(model.id, {
        enabled: next === 'running',
      })
      refreshModels()
      refresh()
      refetchInferenceStatus()
      toast.success(
        next === 'running' ? `${model.name} starting` : `${model.name} stopped`,
      )
    } catch (err) {
      // The server's OWN reason, not a guess. putScheduleService refuses for
      // eight distinct causes (no PRODUCTION version, a feature derived from
      // the target, a scaled target, no feature columns, a missing dataset,
      // an ambiguous or foreign sourceId, no recorded fetch config) and
      // `fetchClient` already carries each message verbatim. Printing one of
      // them for all eight sent people looking for a version problem they
      // did not have.
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : next === 'running'
            ? 'Failed to start.'
            : 'Failed to update deploy status',
      )
    } finally {
      setIsToggling(false)
    }
  }

  useEffect(() => {
    if (workspaces.length === 0) return

    let ignore = false

    const fetchModelDetail = async () => {
      setLoading(true)

      try {
        const results = await Promise.all(
          workspaces.map(ws => getModels(ws.id)),
        )
        if (!ignore) {
          const found = results.flat().find(m => m.id === id) ?? null
          setModel(found)
          setLoading(false)
        }
      } catch {
        if (!ignore) {
          setModel(null)
          setLoading(false)
        }
      }
    }

    void fetchModelDetail()

    return () => {
      ignore = true
    }
  }, [id, workspaces, version])

  if (loading) {
    return <LoadingModelPage />
  }

  if (!model) {
    return <ErrorModelPage />
  }

  // MODEL-SERVE-001-T09. `inferenceStatus.deployStatus` when it has
  // resolved — the SAME classifyDeployStatus every read of this model
  // shares — falling back to the model's own last-fetched value only for
  // the brief window before the first status read lands.
  const deployKey = (inferenceStatus?.deployStatus ??
    model.data?.deployStatus ??
    'stopped') as keyof typeof DEPLOY_CONFIG
  // MODEL-SERVE-001-T19. Start/Stop must branch on the SETTING the
  // operator owns, not the derived word above — `deployKey` reads 'error'
  // for an enabled-but-failing schedule, and branching on it left that
  // model with a Start button and no way to Stop (see this task's audit).
  // `inferenceStatus.enabled` already exists on this same payload
  // (getStatusService's own response); no new endpoint or field needed.
  const isEnabled = inferenceStatus?.enabled ?? model.data?.enabled ?? false
  // MODEL-SERVE-012. ONE monitoring verdict, derived from the MEASURED
  // health axis rather than the hand-set `prodStatus` column — see
  // `monitoringStatusFromHealth`'s own comment for why the two badges merged.
  //
  // FROM `inferenceStatus`, NOT from `model.data.monitoring`. The list
  // payload carries LIVENESS ONLY (`deriveDeployStatuses` passes
  // driftMonitor: false and residualSdStatus: 'UNKNOWN'), so it can never
  // report OK or WARN — reading it here would badge a healthy running model
  // "Offline", and a warning one "Offline · residual 1–2SD". This is also
  // the same source the reason code below comes from, so the two halves of
  // the pill can never disagree.
  const monitoringDisabled = deployKey === 'stopped' || deployKey === 'error'
  const prodKey = monitoringStatusFromHealth(
    inferenceStatus?.health.status,
    deployKey,
  )
  const deploy = DEPLOY_CONFIG[deployKey] ?? DEPLOY_CONFIG.stopped
  const prod = PROD_CONFIG[prodKey]
  const DeployIcon = deploy.icon
  const ProdIcon = prod.icon
  // MODEL-SERVE-012. The reason code survived the badge merge: it is what
  // distinguishes faults with OPPOSITE fixes, so it renders beside the
  // status word rather than being inferred from it. Null for every state
  // that carries no fault, so a healthy badge shows nothing extra.
  //
  // Read from `inferenceStatus` (the detail-page status call), which is also
  // where the residual-SD verdict arrives — the list payload carries the
  // same codes under `data.monitoring.reason` for the Alerts page.
  const healthReason = inferenceStatus?.health.reason
    ? HEALTH_REASON_LABEL[inferenceStatus.health.reason]
    : null
  const lastFailure = inferenceStatus?.lastFailure ?? null
  const lastSkipped = inferenceStatus?.lastSkipped ?? null

  /**
   * MODEL-SERVE-011-T23. The algorithm this model was configured with, in
   * the words the wizard uses — `ALGORITHM_LABELS` is the SAME map Step 3
   * and the deploy summary render from, so "Random Forest" cannot come to
   * mean two different things in two screens.
   *
   * SOURCE IS `data.config`, the saved wizard configuration. The version
   * actually serving traffic carries its own `sourceRun.algorithm`, which is
   * the stronger answer but is exposed by no client endpoint today; the two
   * agree on every model in this database, and they can only diverge if a
   * retrain lands a different algorithm than the one configured. Rendered as
   * "configured" rather than "running" for that reason.
   */
  const algorithmLabel = model.data?.config?.algorithm
    ? (ALGORITHM_LABELS[model.data.config.algorithm] ??
      model.data.config.algorithm)
    : null
  // A candidate sweep keeps every algorithm it was allowed to try; the extra
  // count says the primary was CHOSEN rather than the only option.
  const algorithmAlternatives = (model.data?.config?.algorithms ?? []).filter(
    a => a !== model.data?.config?.algorithm,
  ).length

  const nodeName = model.nodes
    ? ((model.nodes.data as { name?: string }).name ?? '—')
    : '—'
  const plantName = model.nodes?.plan?.name ?? '—'

  const editHistory = [...(model.data?.editHistory ?? [])].reverse()

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      {/* DESIGN_SYSTEM.md's own content width (`max-w-7xl mx-auto`, and the
          canonical wrapper `mx-auto w-full max-w-7xl space-y-6`). This page
          had been pinned to `max-w-5xl`, narrower than the system it belongs
          to, which is why the Monitoring charts scrolled sideways on a wide
          screen instead of using it. `max-w-7xl` is 80rem, so on anything
          below that the page is already full-bleed and nothing changes for
          smaller screens — the extra room only appears where there is room
          to give. */}
      <div className="mx-auto w-full max-w-7xl space-y-6">
        {/* Back */}
        <Link
          href="/models/views"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Box className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-foreground">
                  {model.name}
                </h1>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    deploy.cls,
                  )}
                >
                  <DeployIcon className="h-3 w-3" />
                  {deploy.label}
                </span>
                {/* MODEL-SERVE-012. THE monitoring badge — the Health pill
                    that used to sit beside this one is gone, and this one is
                    now derived from that same measured axis. Labelled
                    "Monitoring:" so a reader knows WHICH axis it speaks for;
                    the deploy pill to its left keeps its own word. */}
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    prod.cls,
                    monitoringDisabled && 'opacity-50',
                  )}
                >
                  <ProdIcon className="h-3 w-3" />
                  {/* The status word alone. The axis is already named by the
                      "Monitoring" KPI below and by the list column, so a
                      "Monitoring:" prefix here only repeats it inside a pill
                      that has to stay narrow. */}
                  {prod.label}
                  {/* The reason is ON SCREEN, never left to be inferred from
                      the status word — Alert collapses faults with opposite
                      fixes (the connector, one instrument, the model itself).
                      Same rule the Health pill carried, kept through the
                      merge. */}
                  {healthReason && ` · ${healthReason}`}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {plantName} · {nodeName}
              </p>
              {algorithmLabel && (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Cpu className="h-3 w-3 shrink-0" />
                  <span className="font-medium text-foreground/80">
                    {algorithmLabel}
                  </span>
                  {algorithmAlternatives > 0 && (
                    <span>
                      · chosen from {algorithmAlternatives + 1} candidates
                    </span>
                  )}
                </p>
              )}
              {/* The SERVING version's own recorded numbers, stated beside
                  the algorithm — "what is live, and how good is it" answered
                  in one place. RMSE leads because it is the metric the whole
                  system selects on (a real run here once scored
                  r2 = -1,110,858 while RMSE stayed sane, MODEL-FLOW-004);
                  R² sits beside it and never ranks anything. A figure the
                  version never recorded reads "not recorded", never 0. */}
              {versionSchema && (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Activity className="h-3 w-3 shrink-0" />
                    <span>v{versionSchema.version}</span>
                  </span>
                  <span>
                    RMSE{' '}
                    <span className="font-medium tabular-nums text-foreground/80">
                      {formatMetricValue(versionSchema.metrics.rmse)}
                    </span>
                  </span>
                  <span>
                    R²{' '}
                    <span className="font-medium tabular-nums text-foreground/80">
                      {formatMetricValue(versionSchema.metrics.r2)}
                    </span>
                  </span>
                </p>
              )}
              {model.data?.lastEditedBy && (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  Last edited by {model.data.lastEditedBy}
                  {model.data.lastEditedAt &&
                    ` · ${new Date(model.data.lastEditedAt).toLocaleString(
                      undefined,
                      {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}`}
                  {model.data.lastEditedFields?.length
                    ? ` · ${model.data.lastEditedFields.join(', ')}`
                    : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Shown only while a promotable version exists. A model with no
                versions at all 404s on input-schema, leaving `schema` null —
                no button, and Start's own message says what to do instead.
                Deliberately NOT folded into Start: promotion changes what is
                in production, which is not a side effect anyone should get
                from a button labelled "Start". */}
            {canPromote && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={promote.busy}
                onClick={() =>
                  void promote.promote(model.id, versionSchema.version)
                }
              >
                <ArrowUpCircle className="h-4 w-4" />
                Promote v{versionSchema.version}
              </Button>
            )}
            {isEnabled ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                // MODEL-SERVE-001-T09. `!deployStatusReady` too — before the
                // first status read resolves, `isEnabled` is only the
                // model's stale last-fetched value, and flipping this
                // button's disabled state out from under the cursor the
                // instant the real read lands is worse than a brief
                // disable.
                disabled={
                  isToggling ||
                  !deployStatusReady ||
                  deployKey === 'initializing'
                }
                onClick={() => setConfirmDeploy('stopped')}
              >
                <StopCircle className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={isToggling || !deployStatusReady}
                onClick={() => setConfirmDeploy('running')}
              >
                <Play className="h-4 w-4" />
                Start
              </Button>
            )}
            {/* MODEL-SERVE-011-T06. Skips the wait for the scheduler's next
                tick, nothing more: it runs the SAME window the tick would
                have run, through the same dispatch path. Gated on
                `isEnabled` because a stopped model is the Start button's
                decision — the server refuses one with a 409 regardless, and
                a button that always fails is worse than one that is plainly
                unavailable. `!deployStatusReady` for the same reason Stop
                carries it: before the first status read, `isEnabled` is only
                the model's stale last-fetched value. */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={
                runPredict.busy ||
                isToggling ||
                !deployStatusReady ||
                !isEnabled
              }
              onClick={() => void runPredict.runPredict(model.id)}
            >
              {/* The wait is REAL and worth showing: this awaits a warm
                  /predict round trip (fetch the last few minutes, score it)
                  before it answers, so a button that only greyed out read as
                  a press that did nothing. Same Loader2 spinner
                  settings/account.tsx already uses for an in-flight
                  mutation. */}
              {runPredict.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {runPredict.busy ? 'Predicting…' : 'Run Predict'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {model && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link
                  href={`/models/create?mode=edit&modelId=${model.id}&workspaceId=${model.workspaceId}`}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Edit configuration
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setRetrainOpen(true)}
            >
              <RefreshCw className="h-4 w-4" />
              Retrain
            </Button>
          </div>
        </div>

        {/* Frozen / missing-data reason */}
        {prodKey === 'frozen' && model.data?.statusDetail && (
          <div className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-700 dark:text-purple-300">
            <Snowflake className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">Data frozen — </span>
              {model.data.statusDetail}
            </span>
          </div>
        )}

        {/* Retrain progress (stage boxes + eval metrics) */}
        <RetrainProgress
          job={retrain.dismissed ? null : retrain.job}
          phase={retrain.dismissed ? 'idle' : retrain.phase}
          logs={retrain.logs}
          onDismiss={retrain.dismiss}
          applying={promote.busy}
          onApplyToProduction={version => {
            // The SAME promote flow the header's own Promote button uses —
            // including its 422 override dialog, already mounted below.
            void promote.promote(model.id, version)
          }}
        />

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground">
                Deploy
              </p>
              <div
                className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                  deploy.cls,
                )}
              >
                <DeployIcon className="h-3.5 w-3.5" />
                {deploy.label}
              </div>
              {/* MODEL-SERVE-001-T19. `error` is a TRANSPORT failure on the
                  status fetch itself (see useInferenceStatus's own doc) —
                  distinct from `deployKey === 'error'` above, which is a
                  real deploy state the fetch SUCCEEDED in reading. Render
                  it only while the fetch has never resolved: it explains
                  why Start/Stop are disabled with no visible cause,
                  otherwise indistinguishable from a press that did nothing. */}
              {!deployStatusReady && inferenceStatusError && (
                <p
                  className="mt-2 line-clamp-2 text-xs text-red-500"
                  title={inferenceStatusError}
                >
                  Status unavailable — {inferenceStatusError}
                </p>
              )}
              {/* MODEL-SERVE-001-T09. The word alone cost a real debugging
                  session hours — `error`/`initializing` are both unreadable
                  without a reason beside them. Never a second verdict: this
                  only DESCRIBES the word `deployKey` already carries. */}
              {deployKey === 'error' && lastFailure && (
                <p
                  className="mt-2 line-clamp-2 text-xs text-muted-foreground"
                  title={lastFailure.reason ?? undefined}
                >
                  {lastFailure.reason ?? 'Failed'} ·{' '}
                  {new Date(lastFailure.windowStart).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
              {deployKey === 'initializing' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No windows yet — first run within{' '}
                  {inferenceStatus?.cadenceMinutes ?? 60} min
                </p>
              )}
              {/* A SKIPPED window is a threshold message, NOT a fault — kept
                  visually distinct (muted, no error styling) so it is never
                  mistaken for one. */}
              {(deployKey === 'running' || deployKey === 'stopped') &&
                lastSkipped && (
                  <p
                    className="mt-2 line-clamp-2 text-xs text-muted-foreground/70"
                    title={lastSkipped.reason ?? undefined}
                  >
                    Last skipped: {lastSkipped.reason ?? '—'}
                  </p>
                )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              {/* MODEL-SERVE-012. "Monitoring", not "Production": this KPI
                  stopped reading the hand-set `prodStatus` column when the
                  badges merged — it is the same measured verdict the header
                  pill and the list column show, so it carries the same
                  name. */}
              <p className="text-xs font-medium text-muted-foreground">
                Monitoring
              </p>
              <div
                className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                  prod.cls,
                  monitoringDisabled && 'opacity-50',
                )}
              >
                <ProdIcon className="h-3.5 w-3.5" />
                {prod.label}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground">
                Deployed On
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-semibold text-foreground">
                  {nodeName}
                </span>
              </div>
              {plantName !== '—' && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {plantName}
                </p>
              )}
              {(model.data?.deployedBy || model.data?.deployedAt) && (
                <div className="mt-2 space-y-0.5 border-t border-border/50 pt-2">
                  {model.data?.deployedBy && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="h-3 w-3 shrink-0" />
                      {model.data.deployedBy}
                    </p>
                  )}
                  {model.data?.deployedAt && (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {new Date(model.data.deployedAt).toLocaleString(
                        undefined,
                        {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="input" className="flex w-full flex-col">
          <div className="mb-4 flex w-full items-center overflow-x-auto pb-1">
            <TabsList className="inline-flex h-10 w-max items-center justify-start p-1">
              <TabsTrigger
                value="input"
                className="flex items-center gap-2 px-4"
              >
                <Database className="h-4 w-4 shrink-0" />
                <span>Input Data</span>
              </TabsTrigger>

              <TabsTrigger
                value="monitoring"
                className="flex items-center gap-2 px-4"
              >
                <BarChart3 className="h-4 w-4 shrink-0" />
                <span>Monitoring</span>
              </TabsTrigger>

              <TabsTrigger
                value="evaluation"
                className="flex items-center gap-2 px-4"
              >
                <Gauge className="h-4 w-4 shrink-0" />
                <span>Evaluation</span>
              </TabsTrigger>

              <TabsTrigger
                value="logs"
                className="flex items-center gap-2 px-4"
              >
                <Terminal className="h-4 w-4 shrink-0" />
                <span>Logs</span>
                {/* MODEL-SERVE-001-T10. The old count badge read
                    `model.data.logs.length`, which is 0 for every model, so
                    it never rendered. A real count would mean fetching every
                    window's lines just to label a tab — the unbounded read
                    this task exists to avoid. */}
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="flex items-center gap-2 px-4"
              >
                <History className="h-4 w-4 shrink-0" />
                <span>Edit History</span>
                {editHistory.length > 0 && (
                  <span className="ml-1 flex h-4 items-center justify-center rounded-full bg-muted-foreground/20 px-2 text-[10px] font-semibold tabular-nums text-foreground">
                    {editHistory.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Input Data ── */}
          <TabsContent value="input" className="mt-0">
            <InputDataTab
              model={model}
              frozenColumns={inferenceStatus?.health.frozenColumns ?? []}
              frozenSince={inferenceStatus?.health.frozenSince ?? []}
            />
          </TabsContent>

          {/* ── Edit History ── */}
          <TabsContent value="history" className="mt-4">
            <Card className="overflow-hidden border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Edited By</TableHead>
                    <TableHead>Fields Changed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border">
                  {editHistory.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        No edits recorded yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    editHistory.map((entry, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {new Date(entry.at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-foreground">
                          {entry.by}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.fields.join(', ')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* ── Monitoring ── */}
          <TabsContent value="monitoring" className="mt-4">
            <ModelMonitoringTab model={model} refreshKey={monitoringKey} />
          </TabsContent>

          {/* ── Evaluation ── */}
          <TabsContent value="evaluation" className="mt-4">
            <ModelEvaluation model={model} />
          </TabsContent>

          {/* ── Logs ── */}
          {/* MODEL-SERVE-001-T10. Was `model.data.logs`, a JSON array that
              is initialized [] and whose only writer has no client caller —
              permanently empty on every model. Now the container's own
              stdout, per inference window. */}
          <TabsContent value="logs" className="mt-4">
            <WindowLogsTab modelId={model.id} />
          </TabsContent>
        </Tabs>
      </div>

      <ModelUpsertDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={refresh}
        workspaces={workspaces}
        model={model}
      />
      <ModelRetrainDialog
        open={retrainOpen}
        onClose={() => setRetrainOpen(false)}
        model={model}
        incumbent={retrain.incumbent}
        loading={retrain.loading}
        isRetraining={retrain.isRetraining}
        error={retrain.error}
        onStart={(candidates, options) => {
          void retrain.start(candidates, options)
        }}
      />
      <AlertDialog
        open={confirmDeploy !== null}
        onOpenChange={open => !open && setConfirmDeploy(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDeploy === 'running'
                ? `Start "${model.name}"?`
                : `Stop "${model.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeploy === 'running'
                ? 'This will begin inference. Running models consume resources.'
                : 'This will halt inference immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeploy) void handleToggleDeploy(confirmDeploy)
                setConfirmDeploy(null)
              }}
            >
              {confirmDeploy === 'running' ? 'Start' : 'Stop'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODEL-SERVE-001-T06. Opened only by a 422 from the promote
          endpoint, and it quotes that refusal VERBATIM rather than
          paraphrasing it — the same 422 also covers a missing artifact and a
          changed checksum, which no reason can override, and only the
          server's own wording tells those apart. */}
      <AlertDialog
        open={promote.overridePrompt !== null}
        onOpenChange={open => {
          if (!open) {
            promote.dismissOverride()
            setOverrideReason('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote anyway?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                  {promote.overridePrompt}
                </p>
                <p>
                  Promoting past this check is recorded against your name with
                  the reason you give below.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            rows={3}
            placeholder="Why should this version go to production anyway?"
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!overrideReason.trim() || promote.busy}
              onClick={e => {
                e.preventDefault()
                void promote.confirmOverride(overrideReason)
              }}
            >
              Promote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
