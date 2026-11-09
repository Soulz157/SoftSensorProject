/**
 * CONTAINER-QUEUE-001. Which containers the host can run at once. Pure, so
 * every admission branch is table-tested; ContainerDispatchService supplies
 * what is running and acts on the answer.
 *
 * Reservations are what a mode is ALLOWED to use (its Docker caps), not what it
 * happens to be using, so a job admitted now cannot OOM a neighbour later.
 */

import { configuredNanoCpus } from './trainer-cpu';

export type ContainerMode = 'train' | 'score' | 'batch' | 'infer';

export interface ContainerResources {
  cpus: number;
  memoryBytes: number;
}

export interface HostBudget {
  total: ContainerResources;
  /** Train and batch may not use this slice. A long training must not be able
   *  to stop scheduled inference, whose missed windows are a monitoring gap. */
  heldForMonitoring: ContainerResources;
}

export interface RunningContainer {
  mode: ContainerMode;
  workspaceId: string | null;
}

export type Admission =
  | { kind: 'fit' }
  | { kind: 'no-room' }
  | { kind: 'workspace-cap' }
  | { kind: 'too-big'; reason: string };

const GIB = 1024 ** 3;

/**
 * What each mode may use, overridable per deployment. Defaults come from peak
 * cgroup memory in the trainer image on the largest real dataset (35,593 rows x
 * 129 tags, 2 CPUs, 2026-11-09): Gaussian Process 2.40 GiB at its 10,000-row
 * ceiling, LSTM 1.74, parallel forest grid search 0.70, Extra Trees 0.57,
 * LightGBM 0.43, Random Forest 0.39, XGBoost 0.25, library load plus a small
 * predict 0.33. The margin covers parquet staged on
 * the /scratch tmpfs, which counts against the same cap.
 */
export function containerProfiles(): Record<ContainerMode, ContainerResources> {
  const read = (key: string, fallback: number) =>
    Number(process.env[key] ?? fallback);
  return {
    train: {
      cpus: configuredNanoCpus() / 1e9,
      memoryBytes: read('TRAINING_MEMORY_BYTES', 4 * GIB),
    },
    score: {
      cpus: read('CONTAINER_SCORE_CPUS', 1),
      memoryBytes: read('CONTAINER_SCORE_MEMORY_BYTES', 2 * GIB),
    },
    batch: {
      cpus: read('CONTAINER_BATCH_CPUS', 1),
      memoryBytes: read('CONTAINER_BATCH_MEMORY_BYTES', 2 * GIB),
    },
    infer: {
      cpus: read('CONTAINER_INFER_CPUS', 1),
      memoryBytes: read('CONTAINER_INFER_MEMORY_BYTES', GIB),
    },
  };
}

/** Modes a user starts in bulk and that can run for hours. */
function isBackground(mode: ContainerMode): boolean {
  return mode === 'train' || mode === 'batch';
}

function sum(
  running: RunningContainer[],
  profiles: Record<ContainerMode, ContainerResources>,
): ContainerResources {
  return running.reduce(
    (used, c) => ({
      cpus: used.cpus + profiles[c.mode].cpus,
      memoryBytes: used.memoryBytes + profiles[c.mode].memoryBytes,
    }),
    { cpus: 0, memoryBytes: 0 },
  );
}

function fits(need: ContainerResources, limit: ContainerResources): boolean {
  return need.cpus <= limit.cpus && need.memoryBytes <= limit.memoryBytes;
}

function formatGib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

export function admit(input: {
  mode: ContainerMode;
  workspaceId: string | null;
  running: RunningContainer[];
  profiles: Record<ContainerMode, ContainerResources>;
  budget: HostBudget;
  maxActivePerWorkspace: number;
}): Admission {
  const { mode, workspaceId, running, profiles, budget } = input;
  const need = profiles[mode];
  const background = isBackground(mode);
  const limit: ContainerResources = background
    ? {
        cpus: budget.total.cpus - budget.heldForMonitoring.cpus,
        memoryBytes:
          budget.total.memoryBytes - budget.heldForMonitoring.memoryBytes,
      }
    : budget.total;

  // Checked first: waiting would never help, and the row must say why.
  if (!fits(need, limit)) {
    return {
      kind: 'too-big',
      reason:
        `This job needs ${need.cpus} CPU and ${formatGib(need.memoryBytes)}, ` +
        `but this server can give it at most ${limit.cpus} CPU and ` +
        `${formatGib(limit.memoryBytes)}.`,
    };
  }

  // Before the room check: a workspace at its cap waits alone, and must not
  // read as "the host is full", which pauses everybody's jobs.
  if (background && workspaceId !== null) {
    const active = running.filter(
      (c) => isBackground(c.mode) && c.workspaceId === workspaceId,
    ).length;
    if (active >= input.maxActivePerWorkspace) return { kind: 'workspace-cap' };
  }

  const plus = (used: ContainerResources): ContainerResources => ({
    cpus: used.cpus + need.cpus,
    memoryBytes: used.memoryBytes + need.memoryBytes,
  });
  if (!fits(plus(sum(running, profiles)), budget.total)) {
    return { kind: 'no-room' };
  }
  // Inference and scoring already running are what the held slice is for, so
  // only background work counts against the background limit.
  if (
    background &&
    !fits(
      plus(
        sum(
          running.filter((c) => isBackground(c.mode)),
          profiles,
        ),
      ),
      limit,
    )
  ) {
    return { kind: 'no-room' };
  }
  return { kind: 'fit' };
}

/** What the host offers containers: explicit overrides win, otherwise Docker's
 *  own totals minus what Postgres, MinIO and Redis need. */
export function hostTotal(input: {
  dockerCpus: number;
  dockerMemoryBytes: number;
  reserve: ContainerResources;
  overrideCpus?: number;
  overrideMemoryBytes?: number;
}): ContainerResources {
  return {
    cpus:
      input.overrideCpus ?? Math.max(0, input.dockerCpus - input.reserve.cpus),
    memoryBytes:
      input.overrideMemoryBytes ??
      Math.max(0, input.dockerMemoryBytes - input.reserve.memoryBytes),
  };
}

/**
 * BullMQ priority, lower runs first. Live inference leads because a missed
 * reading cannot be recovered; backfill trails training so a catch-up never
 * blocks somebody waiting on a run.
 */
export function jobPriority(mode: ContainerMode, live: boolean): number {
  if (mode === 'infer') return live ? 1 : 5;
  if (mode === 'score') return 2;
  if (mode === 'batch') return 3;
  return 4;
}

/** Docker's `dslake.role` label back to the mode that set it. */
export const MODE_BY_ROLE: Readonly<Record<string, ContainerMode>> = {
  training: 'train',
  scoring: 'score',
  'batch-predict': 'batch',
  'scheduled-inference': 'infer',
};
