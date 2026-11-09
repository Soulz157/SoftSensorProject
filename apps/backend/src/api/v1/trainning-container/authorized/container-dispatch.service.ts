import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '@softsensor/prisma';
import { env } from '@/config/env.config';
import {
  admit,
  containerProfiles,
  hostTotal,
  jobPriority,
  type ContainerMode,
  type HostBudget,
} from '@/lib/container-budget';
import { mintRunToken } from '@/lib/mint-run-token';
import { TrainningContainerAuthorizedService } from './trainning-container.authorized.service';

const ADMISSION_QUEUE = 'container-admission';
const PREP_QUEUE = 'inference-prep';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const WARN_EVERY_MS = 60_000;
const REDIS_CALL_TIMEOUT_MS = 2_000;

interface AdmissionData {
  mode: ContainerMode;
  id: string;
}

interface PrepData {
  windowId: string;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `enableOfflineQueue: false` only fails fast once a connection has existed:
 * with Redis down from the start, BullMQ's `add` waits for ready and never
 * settles. Measured on 6.7.2. A user's request must not wait on that.
 */
async function withinTimeout<T>(call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for Redis.')),
          REDIS_CALL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * CONTAINER-QUEUE-001. Decides when a train, score, batch or inference
 * container may start, so concurrent users queue on the host's CPU/RAM instead
 * of all spawning at once.
 *
 * THE DB ROW IS THE SOURCE OF TRUTH. The UI, the token guards and the callbacks
 * read it; BullMQ only decides what is looked at next, and job data carries ids
 * and never a token. That is why losing Redis loses no work: `sweep` re-adds
 * every waiting row.
 *
 * A JOB COVERS ADMISSION, NOT THE CONTAINER'S LIFETIME. It completes as soon as
 * the container has started. Holding it for a multi-hour training would make a
 * backend restart read as a stalled job and run it again, while the container
 * outlives the Node process and is already re-attached at boot.
 *
 * `concurrency: 1` is what makes check-then-spawn safe, so nothing slow may run
 * inside the admission processor. Inference's PI fetch has its own queue for
 * that reason. SINGLE REPLICA, like every other sweep in this backend.
 */
@Injectable()
export class ContainerDispatchService
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(ContainerDispatchService.name);
  private admission: Queue<AdmissionData> | null = null;
  private prep: Queue<PrepData> | null = null;
  private admissionWorker: Worker<AdmissionData> | null = null;
  private prepWorker: Worker<PrepData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private budget: HostBudget | null = null;
  private prepareWindow: ((windowId: string) => Promise<void>) | null = null;
  private sweeping = false;
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TrainningContainerAuthorizedService,
  ) {}

  onModuleInit(): void {
    const url = env.REDIS_URL;
    // Producers fail fast: a launch must not hang on a Redis outage, its row is
    // already durable and the sweep enqueues it after reconnect.
    const producer = { url, enableOfflineQueue: false };
    this.admission = new Queue<AdmissionData>(ADMISSION_QUEUE, {
      connection: producer,
    });
    this.prep = new Queue<PrepData>(PREP_QUEUE, { connection: producer });

    // `autorun: false` until bootstrap, when the scheduler has registered its
    // prepare step. Workers keep the default offline queue so they reconnect.
    this.admissionWorker = new Worker<AdmissionData>(
      ADMISSION_QUEUE,
      (job, token) => this.processAdmission(job, token),
      {
        connection: { url },
        concurrency: 1,
        autorun: false,
        // Required for the manual rate limit; high enough to never apply.
        limiter: { max: 1000, duration: 1000 },
      },
    );
    this.prepWorker = new Worker<PrepData>(
      PREP_QUEUE,
      (job) => this.processPrep(job),
      {
        connection: { url },
        concurrency: env.INFERENCE_PREP_CONCURRENCY,
        autorun: false,
      },
    );

    const onOutage = (err: Error) => this.warnOutage(err);
    this.admission.on('error', onOutage);
    this.prep.on('error', onOutage);
    this.admissionWorker.on('error', onOutage);
    this.prepWorker.on('error', onOutage);
    this.admissionWorker.on('failed', (job, err) => {
      this.log.error(`Admission job ${job?.id ?? '?'} failed: ${err.message}`);
    });
    this.prepWorker.on('failed', (job, err) => {
      this.log.error(`Prep job ${job?.id ?? '?'} failed: ${err.message}`);
    });
  }

  onApplicationBootstrap(): void {
    for (const worker of [this.admissionWorker, this.prepWorker]) {
      void worker?.run().catch((err: unknown) => this.warnOutage(err));
    }
    if (env.CONTAINER_QUEUE_SWEEP_MS <= 0) {
      this.log.log('Container queue sweep disabled.');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep();
    }, env.CONTAINER_QUEUE_SWEEP_MS);
    this.timer.unref();
    void this.sweep();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(
      [
        this.admissionWorker?.close(),
        this.prepWorker?.close(),
        this.admission?.close(),
        this.prep?.close(),
      ].map((closing) => withinTimeout(Promise.resolve(closing))),
    );
  }

  /** The inference scheduler's materialize step, which this module cannot
   *  import without a cycle. */
  registerInferencePrep(prepare: (windowId: string) => Promise<void>): void {
    this.prepareWindow = prepare;
  }

  /**
   * Never rejects or hangs. The row is durable before this runs, so a failed
   * add is repaired by the next sweep. Idempotent: the jobId dedupes a repeat.
   * False when Redis could not take it.
   */
  async enqueue(
    mode: ContainerMode,
    id: string,
    opts: { live?: boolean } = {},
  ): Promise<boolean> {
    try {
      await withinTimeout(
        Promise.resolve(
          this.admission?.add(
            mode,
            { mode, id },
            {
              jobId: `${mode}-${id}`,
              priority: jobPriority(mode, opts.live ?? true),
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: true,
            },
          ),
        ),
      );
      return true;
    } catch (err) {
      this.warnOutage(err);
      return false;
    }
  }

  /** Same contract as `enqueue`. Skips a window already prepared and waiting
   *  for admission, so the tick's re-request cannot fetch it from PI twice. */
  async enqueueInferencePrep(windowId: string, live: boolean): Promise<void> {
    try {
      const waiting = await withinTimeout(
        Promise.resolve(this.admission?.getJob(`infer-${windowId}`)),
      );
      if (waiting) return;
      await withinTimeout(
        Promise.resolve(
          this.prep?.add(
            'prep',
            { windowId },
            {
              jobId: `prep-${windowId}`,
              priority: jobPriority('infer', live),
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: true,
            },
          ),
        ),
      );
    } catch (err) {
      this.warnOutage(err);
    }
  }

  /** Best-effort: the processor re-reads the row, so a job that survives this
   *  is a no-op. */
  async remove(mode: ContainerMode, id: string): Promise<void> {
    try {
      await withinTimeout(
        Promise.resolve(this.admission?.remove(`${mode}-${id}`)),
      );
    } catch (err) {
      this.log.warn(`Could not remove job ${mode}-${id}: ${msg(err)}`);
    }
  }

  private async processPrep(job: Job<PrepData>): Promise<void> {
    if (!this.prepareWindow) {
      throw new Error('Inference prepare step is not registered.');
    }
    await this.prepareWindow(job.data.windowId);
  }

  private async processAdmission(
    job: Job<AdmissionData>,
    lockToken?: string,
  ): Promise<void> {
    const { mode, id } = job.data;
    const target = await this.findWaiting(mode, id);
    if (!target) return;

    // A crash between start() and the status write leaves a live container
    // behind a waiting row. Starting another would fail on its name.
    if (await this.runner.adopt(id, mode)) return;

    const running = await this.runner.listRunning();
    const decision = admit({
      mode,
      workspaceId: target.workspaceId,
      running,
      profiles: containerProfiles(),
      budget: await this.hostBudget(),
      maxActivePerWorkspace: env.CONTAINER_MAX_ACTIVE_PER_WORKSPACE,
    });

    if (decision.kind === 'too-big') {
      await this.failRow(mode, id, decision.reason);
      return;
    }
    if (decision.kind === 'workspace-cap') {
      await job.moveToDelayed(
        Date.now() + env.CONTAINER_QUEUE_RECHECK_MS,
        lockToken,
      );
      throw new DelayedError();
    }
    if (decision.kind === 'no-room') {
      // Pauses the whole queue on purpose: the highest-priority job that does
      // not fit must not be overtaken, or large trainings never start. The job
      // returns to the queue keeping its priority.
      await this.admission?.rateLimit(env.CONTAINER_QUEUE_RECHECK_MS);
      throw Worker.RateLimitError();
    }

    // Minted here, not at launch: time in the queue must not use up the token,
    // and the plaintext is never stored anywhere to hand over later.
    const { token, tokenHash } = mintRunToken();
    if (!(await this.writeToken(mode, id, tokenHash))) return;
    try {
      await this.runner.spawn(id, token, mode, target.workspaceId);
    } catch (err) {
      this.log.error(`spawn failed for ${mode} ${id}`, err);
      await this.failRow(mode, id, `Could not start container: ${msg(err)}`);
    }
  }

  private async hostBudget(): Promise<HostBudget> {
    if (this.budget) return this.budget;
    const info = await this.runner.dockerInfo();
    this.budget = {
      total: hostTotal({
        dockerCpus: info.NCPU,
        dockerMemoryBytes: info.MemTotal,
        reserve: {
          cpus: env.CONTAINER_HOST_RESERVE_CPUS,
          memoryBytes: env.CONTAINER_HOST_RESERVE_MEMORY_BYTES,
        },
        overrideCpus: env.CONTAINER_BUDGET_CPUS,
        overrideMemoryBytes: env.CONTAINER_BUDGET_MEMORY_BYTES,
      }),
      heldForMonitoring: {
        cpus: env.CONTAINER_HELD_CPUS,
        memoryBytes: env.CONTAINER_HELD_MEMORY_BYTES,
      },
    };
    this.log.log(`Container budget: ${JSON.stringify(this.budget)}`);
    return this.budget;
  }

  /** Null when the row no longer wants a container: canceled, stopped,
   *  deleted, or already picked up. */
  private async findWaiting(
    mode: ContainerMode,
    id: string,
  ): Promise<{ workspaceId: string | null } | null> {
    if (mode === 'train') {
      const run = await this.prisma.modelTrainingRun.findUnique({
        where: { id },
        select: {
          status: true,
          model: { select: { workspaceId: true } },
          modelDraft: { select: { workspaceId: true } },
        },
      });
      if (run?.status !== 'QUEUED') return null;
      return {
        workspaceId:
          run.model?.workspaceId ?? run.modelDraft?.workspaceId ?? null,
      };
    }
    if (mode === 'batch') {
      const job = await this.prisma.predictionJob.findUnique({
        where: { id },
        select: { status: true, model: { select: { workspaceId: true } } },
      });
      if (job?.status !== 'QUEUED') return null;
      return { workspaceId: job.model.workspaceId };
    }
    if (mode === 'score') {
      const run = await this.prisma.modelTrainingRun.findUnique({
        where: { id },
        select: { scoringQueuedAt: true, scoringContainerId: true },
      });
      if (!run?.scoringQueuedAt || run.scoringContainerId) return null;
      return { workspaceId: null };
    }
    const window = await this.prisma.inferenceWindow.findUnique({
      where: { id },
      select: { status: true },
    });
    return window?.status === 'PENDING' ? { workspaceId: null } : null;
  }

  /** False when the row left its waiting state since it was read. */
  private async writeToken(
    mode: ContainerMode,
    id: string,
    tokenHash: string,
  ): Promise<boolean> {
    const data = {
      tokenHash,
      tokenExpiresAt: new Date(Date.now() + this.maxRuntimeMs(mode)),
    };
    if (mode === 'batch') {
      const { count } = await this.prisma.predictionJob.updateMany({
        where: { id, status: 'QUEUED' },
        data,
      });
      return count > 0;
    }
    if (mode === 'infer') {
      const { count } = await this.prisma.inferenceWindow.updateMany({
        where: { id, status: 'PENDING' },
        data,
      });
      return count > 0;
    }
    const { count } = await this.prisma.modelTrainingRun.updateMany({
      where:
        mode === 'score'
          ? { id, scoringQueuedAt: { not: null } }
          : { id, status: 'QUEUED' },
      data,
    });
    return count > 0;
  }

  /** Matches the token each mode is given: past this its callbacks are refused
   *  anyway, so the container can only be wasting capacity. */
  private maxRuntimeMs(mode: ContainerMode): number {
    if (mode === 'train') return 12 * 60 * 60 * 1000;
    if (mode === 'infer') return env.INFERENCE_WINDOW_TOKEN_TTL_MS;
    return TWO_HOURS_MS;
  }

  private async failRow(
    mode: ContainerMode,
    id: string,
    reason: string,
  ): Promise<void> {
    const failureReason = reason.slice(0, 2000);
    const data = {
      status: 'FAILED' as const,
      failureReason,
      finishedAt: new Date(),
      tokenExpiresAt: new Date(0),
    };
    if (mode === 'train') {
      await this.prisma.modelTrainingRun.updateMany({
        where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
        data,
      });
    } else if (mode === 'batch') {
      await this.prisma.predictionJob.updateMany({
        where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
        data,
      });
    } else if (mode === 'infer') {
      await this.prisma.inferenceWindow.updateMany({
        where: { id, status: { in: ['PENDING', 'RUNNING'] } },
        data,
      });
    } else {
      // A scoring failure never touches the run's own terminal status.
      await this.prisma.modelTrainingRun.updateMany({
        where: { id },
        data: { scoringQueuedAt: null },
      });
      await this.prisma.modelTrainingRunLog.create({
        data: { runId: id, level: 'error', message: failureReason },
      });
    }
  }

  /**
   * Repairs what Redis cannot know about: a crash between the row commit and
   * the add, an outage, or lost Redis data. Windows are re-requested by the
   * inference tick instead, which already owns the enabled-schedule filter.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const oldest = new Date(Date.now() - env.CONTAINER_QUEUE_MAX_WAIT_MS);
      const [runs, jobs, scores] = await Promise.all([
        this.prisma.modelTrainingRun.findMany({
          where: { status: 'QUEUED' },
          select: { id: true, createdAt: true },
        }),
        this.prisma.predictionJob.findMany({
          where: { status: 'QUEUED' },
          select: { id: true, createdAt: true },
        }),
        this.prisma.modelTrainingRun.findMany({
          where: { scoringQueuedAt: { not: null }, scoringContainerId: null },
          select: { id: true, scoringQueuedAt: true },
        }),
      ]);
      const waiting: { mode: ContainerMode; id: string; since: Date }[] = [
        ...runs.map((r) => ({
          mode: 'train' as const,
          id: r.id,
          since: r.createdAt,
        })),
        ...jobs.map((j) => ({
          mode: 'batch' as const,
          id: j.id,
          since: j.createdAt,
        })),
        ...scores.map((s) => ({
          mode: 'score' as const,
          id: s.id,
          since: s.scoringQueuedAt ?? new Date(),
        })),
      ];
      for (const row of waiting) {
        if (row.since < oldest) {
          await this.remove(row.mode, row.id);
          await this.failRow(
            row.mode,
            row.id,
            'Waited too long for compute capacity and was not started.',
          );
        } else if (!(await this.enqueue(row.mode, row.id))) {
          // Redis is out; the rest would each wait out the same timeout.
          break;
        }
      }
      await this.killOverRuntime();
    } catch (err) {
      this.log.warn(`Container queue sweep failed: ${msg(err)}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async killOverRuntime(): Promise<void> {
    const now = Date.now();
    for (const c of await this.runner.listRunning()) {
      if (now - c.startedAtMs <= this.maxRuntimeMs(c.mode)) continue;
      // The reason first: `watch` only fills in a row that is still running,
      // so it will not replace this with a bare exit code.
      await this.failRow(
        c.mode,
        c.runId,
        'Stopped: the container ran past its maximum allowed time.',
      );
      await this.runner.kill(c.containerId);
    }
  }

  /** One line per minute during an outage, not one per reconnect attempt. */
  private warnOutage(err: unknown): void {
    if (Date.now() - this.lastWarnAt < WARN_EVERY_MS) return;
    this.lastWarnAt = Date.now();
    this.log.warn(`Redis queue unavailable: ${msg(err)}`);
  }
}
