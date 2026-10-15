import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';
import { PrismaService } from '@softsensor/prisma';

/**
 * Spawns training containers over the Docker socket.
 *
 * The socket is root-equivalent on the host, so everything here is written on
 * the assumption that the IMAGE is trusted but the CODE INSIDE IT may not
 * behave: no host binds, all capabilities dropped, no privilege escalation,
 * hard memory/CPU/pid caps, and a tmpfs for scratch instead of a writable
 * rootfs. The container reaches exactly two things — the NestJS internal API
 * and MinIO — and gets no credential for either beyond a single-run token.
 */

@Injectable()
export class TrainningContainerAuthorizedService implements OnModuleInit {
  private readonly log = new Logger(TrainningContainerAuthorizedService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  /** Digest, resolved once at boot. See resolveDigest. */
  imageDigest = '';

  
  // 1.0.21 — MODEL-FLOW-028. pipelines/cv_expanding.py keeps each fold's
  // out-of-fold predictions and publishes them as `cv_oof_predictions.parquet`
  // (new TrainingResult.extra_parquet; MIRRORS.md entry 12) instead of
  // discarding them. ADDITIVE: every non-CV run is byte-for-byte 1.0.20. A CV
  // run trained on an older image has no such file and never will. Built by
  // the user (2026-10-08, image 51d727619caa); trainer suite 83/83 run against
  // the mounted source, and the built image confirmed to contain the new code.
  // Not pushed.
  //
  // 1.0.23 — MODEL-FLOW-033. build_model gains `extra_trees`
  // (sklearn ExtraTreesRegressor, random_forest's five knobs) and it reports
  // impurity importance. ADDITIVE: every other algorithm is unchanged. Built by
  // the user (2026-10-15, image 6a078a741f27); the image's own code confirmed
  // to contain the branch and to fit an ExtraTreesRegressor, and the trainer
  // suite passes 89/89 inside it. Not pushed.
  private readonly imageRef =
    process.env.TRAINING_IMAGE ?? 'scgc/soft-sensor-trainer:1.0.23';
  // private readonly network = process.env.TRAINING_NETWORK ?? 'dslake_default';
  private readonly network = 'monorepo_network';
  private readonly memoryBytes = Number(
    process.env.TRAINING_MEMORY_BYTES ?? 8 * 1024 ** 3,
  );
  private readonly nanoCpus = Number(process.env.TRAINING_NANO_CPUS ?? 2 * 1e9);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.resolveDigest();
    await this.reconcileOrphanedRuns();
  }

  /**
   * MODEL-FLOW-011-T04. `watch()`'s in-memory `container.wait()` promise
   * dies with the process — a `nest --watch` restart (or a real deploy) can
   * therefore strand a run at RUNNING forever with a container the daemon
   * either no longer has, or that finished without anyone noticing.
   * `ModelTrainingRun.containerId` is what survives the restart; this walks
   * every RUNNING row and reconciles it against the daemon's own state.
   *
   * Deliberately an EXISTENCE check per row, not the blanket
   * `updateMany({status:'RUNNING'} -> FAILED)` `PreprocessingJobService`/
   * `LoaderJobService` use for their own boot sweeps: unlike a preprocessing
   * job, a training container is independent of the Node process and can
   * still be alive (or already finished) across a `nest --watch` restart —
   * failing it outright would kill a run that was never actually orphaned.
   */
  private async reconcileOrphanedRuns() {
    const orphans = await this.prisma.modelTrainingRun.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, containerId: true },
    });
    // MODEL-FLOW-016-T07. A scoring container never touches `status` (it
    // stays at the run's own terminal value throughout — see
    // `scoringContainerId`'s doc comment), so the training sweep above
    // cannot see it. Same restart hazard, same fix: without this, a
    // restart during scoring strands `scoringContainerId` set forever and
    // the UI polls a phase that will never finish.
    const scoringOrphans = await this.prisma.modelTrainingRun.findMany({
      where: { scoringContainerId: { not: null } },
      select: { id: true, scoringContainerId: true },
    });

    let reconciled = 0;
    for (const run of orphans) {
      if (!run.containerId) {
        await this.prisma.modelTrainingRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            failureReason:
              'No container was ever recorded for this run — it never spawned.',
            finishedAt: new Date(),
          },
        });
        reconciled += 1;
        continue;
      }

      const container = this.docker.getContainer(run.containerId);
      try {
        await container.inspect();
      } catch {
        await this.prisma.modelTrainingRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            failureReason:
              `Container ${run.containerId} no longer exists — the server ` +
              'restarted while this run was in flight.',
            finishedAt: new Date(),
          },
        });
        reconciled += 1;
        continue;
      }

      // The container still exists — re-attach the watcher regardless of
      // whether it is still running or already exited: container.wait()
      // resolves IMMEDIATELY for an already-stopped container, so this one
      // call covers both cases through the same exit-code branch watch()
      // already writes, rather than a second copy of that logic here.
      void this.watch(run.id, container, 'train');
      reconciled += 1;
    }

    for (const run of scoringOrphans) {
      if (!run.scoringContainerId) continue;
      const container = this.docker.getContainer(run.scoringContainerId);
      try {
        await container.inspect();
      } catch {
        // Container gone — clear the in-flight marker, same as watch()'s
        // own "exited without reporting" branch for scoring below. The
        // training run's own status/metrics are untouched.
        await this.prisma.modelTrainingRun.update({
          where: { id: run.id },
          data: { scoringContainerId: null },
        });
        reconciled += 1;
        continue;
      }
      void this.watch(run.id, container, 'score');
      reconciled += 1;
    }

    // MODEL-SERVE-003-V01. Same existence-check discipline as the training
    // sweep above, not PreprocessingJobService/LoaderJobService's blanket
    // updateMany — a batch container is independent of the Node process for
    // the identical reason a training one is. NOTE (recorded deliberately,
    // not inherited silently): this only reconciles RUNNING, so a job that
    // dies between row-create and spawn stays QUEUED forever — the same gap
    // trainning-container's own training sweep has always had. Acceptable
    // here for the same reason: creation and spawn are both synchronous and
    // fast (createContainer, not a pull), so the window is a process crash
    // landing inside a few hundred milliseconds, not an image pull that can
    // take minutes.
    const batchOrphans = await this.prisma.predictionJob.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, containerId: true },
    });
    for (const job of batchOrphans) {
      if (!job.containerId) {
        await this.prisma.predictionJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            failureReason:
              'No container was ever recorded for this job — it never spawned.',
            finishedAt: new Date(),
          },
        });
        reconciled += 1;
        continue;
      }
      const container = this.docker.getContainer(job.containerId);
      try {
        await container.inspect();
      } catch {
        await this.prisma.predictionJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            failureReason:
              `Container ${job.containerId} no longer exists — the server ` +
              'restarted while this job was in flight.',
            finishedAt: new Date(),
          },
        });
        reconciled += 1;
        continue;
      }
      void this.watch(job.id, container, 'batch');
      reconciled += 1;
    }

    // MODEL-SERVE-006. Same existence-check discipline, one entity over —
    // this is the BOOT-time reconcile (a restart while a window's
    // container was running); InferenceWindowSchedulerService's own
    // reconcileStuckWindows is the separate, TICK-time, TIMEOUT-based
    // reconcile for a window whose container hung without ever posting
    // /infer-complete, which an existence check alone cannot catch. Same
    // acceptable QUEUED-forever-equivalent gap as batch's own note above:
    // a window that dies between row-create and spawn stays PENDING, and
    // the next tick's dispatch simply picks it up again.
    const inferOrphans = await this.prisma.inferenceWindow.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, containerId: true },
    });
    for (const window of inferOrphans) {
      if (!window.containerId) {
        await this.prisma.inferenceWindow.update({
          where: { id: window.id },
          data: {
            status: 'FAILED',
            failureReason:
              'No container was ever recorded for this window — it never spawned.',
            finishedAt: new Date(),
            tokenExpiresAt: new Date(0),
          },
        });
        reconciled += 1;
        continue;
      }
      const container = this.docker.getContainer(window.containerId);
      try {
        await container.inspect();
      } catch {
        await this.prisma.inferenceWindow.update({
          where: { id: window.id },
          data: {
            status: 'FAILED',
            failureReason:
              `Container ${window.containerId} no longer exists — the ` +
              'server restarted while this window was in flight.',
            finishedAt: new Date(),
            tokenExpiresAt: new Date(0),
          },
        });
        reconciled += 1;
        continue;
      }
      void this.watch(window.id, container, 'infer');
      reconciled += 1;
    }

    if (reconciled > 0) {
      this.log.warn(
        `Reconciled ${reconciled} orphaned run/container(s) at boot.`,
      );
    }
  }

  /**
   * Pin the tag to a digest ONCE, at boot.
   *
   * A tag is a moving pointer: two runs recording `:1.0.0` can have executed
   * different code. Recording the digest on every run is what makes
   * imageDigest a reproducibility claim rather than a label.
   */
  private async resolveDigest() {
    try {
      const info = await this.docker.getImage(this.imageRef).inspect();
      this.imageDigest = info.RepoDigests?.[0] ?? info.Id;
    } catch {
      this.log.warn(`Image ${this.imageRef} not present locally — pulling`);
      await new Promise<void>((res, rej) =>
        this.docker.pull(
          this.imageRef,
          (err: unknown, stream: NodeJS.ReadableStream) =>
            err instanceof Error
              ? rej(err)
              : this.docker.modem.followProgress(stream, (e) =>
                  e ? rej(e) : res(),
                ),
        ),
      );
      const info = await this.docker.getImage(this.imageRef).inspect();
      this.imageDigest = info.RepoDigests?.[0] ?? info.Id;
    }
    this.log.log(`Training image pinned to ${this.imageDigest}`);
  }

  /**
   * MODEL-FLOW-016-T07 / MODEL-SERVE-003. `mode` parameterizes ONE spawn
   * path rather than a near-copy per mode — the HostConfig below is ~25
   * lines of security-critical settings (CapDrop, ReadonlyRootfs, Tmpfs,
   * memory caps); separate copies is how they drift out of sync with each
   * other. `train-${id}`, `score-${id}`, `batch-${id}` are deliberately
   * DIFFERENT container names — the training container has already exited
   * by the time scoring starts (see `claim()`'s doc comment), but a stale
   * name collision would still be possible if the training container were
   * ever kept (`TRAINING_KEEP_FAILED=1`).
   *
   * `id` is a `ModelTrainingRun.id` for train/score, a `PredictionJob.id`
   * for batch — the Docker Env var stays the generic `RUN_ID` either way
   * (see `RunContext.api`'s own doc comment on the trainer side for why the
   * route BASE branches on mode there, not the env var name here).
   */
  async spawn(
    id: string,
    token: string,
    mode: 'train' | 'score' | 'batch' | 'infer' = 'train',
  ) {
    const container = await this.docker.createContainer({
      Image: this.imageDigest || this.imageRef,
      name: `${mode}-${id}`,
      Env: [
        `RUN_ID=${id}`,
        `RUN_TOKEN=${token}`,
        `API_BASE=${process.env.INTERNAL_API_BASE ?? 'http://backend:3000'}`,
        `MODE=${mode}`,
      ],
      Labels: {
        'dslake.role':
          mode === 'score'
            ? 'scoring'
            : mode === 'batch'
              ? 'batch-predict'
              : mode === 'infer'
                ? 'scheduled-inference'
                : 'training',
        'dslake.runId': id,
      },
      HostConfig: {
        NetworkMode: this.network,
        // No host filesystem, ever. Everything the run needs arrives over
        // HTTP; everything it produces leaves the same way.
        Binds: [],
        Memory: this.memoryBytes,
        MemorySwap: this.memoryBytes, // no swap — an OOM should fail, not thrash
        NanoCpus: this.nanoCpus,
        PidsLimit: 512,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
        // The one writable path, capped and in RAM. This is where
        // data.parquet is staged — size it above your largest artifact.
        Tmpfs: { '/scratch': 'rw,size=2g,mode=1777' },
        // Kept after exit on purpose: the exit code and docker logs are the
        // only evidence left when a container dies before it can POST
        // /complete. Reaped by `reap()` below.
        AutoRemove: false,
      },
    });

    // `mode === 'score'` writes ONLY scoringContainerId — status/containerId/
    // startedAt belong to the TRAINING spawn and must not be clobbered by a
    // scoring run against an already-terminal (SUCCEEDED) row.
    //
    // Ordering differs by mode, deliberately: `ScoreTokenGuard` admits a
    // call ONLY when `scoringContainerId` is already set — there is no
    // equivalent "not started yet" state it accepts the way RunTokenGuard
    // accepts QUEUED for training. Writing it BEFORE `start()` (container
    // ids are assigned by `createContainer`, not `start`) closes the race
    // where a fast-booting container's own `/score-claim` could 401
    // against a row the update hadn't reached yet. The training branch
    // stays AFTER start() on purpose — marking a run RUNNING before it
    // has actually started would be worse than the (harmless, guard-
    // admitted) QUEUED window it currently has. Batch (MODEL-SERVE-003)
    // follows the training branch's ordering: `PredictionJobTokenGuard`
    // accepts QUEUED the same way RunTokenGuard does, so there is no
    // equivalent race to close by writing early.
    if (mode === 'score') {
      await this.prisma.modelTrainingRun.update({
        where: { id },
        data: { scoringContainerId: container.id },
      });
      await container.start();
    } else if (mode === 'batch') {
      await container.start();
      await this.prisma.predictionJob.update({
        where: { id },
        data: {
          status: 'RUNNING',
          containerId: container.id,
          startedAt: new Date(),
        },
      });
    } else if (mode === 'infer') {
      // MODEL-SERVE-006. Follows batch's ordering — InferenceWindowToken
      // Guard accepts PENDING the same way PredictionJobTokenGuard accepts
      // QUEUED, so there is no equivalent pre-start race to close.
      await container.start();
      await this.prisma.inferenceWindow.update({
        where: { id },
        data: {
          status: 'RUNNING',
          containerId: container.id,
          startedAt: new Date(),
        },
      });
    } else {
      await container.start();
      await this.prisma.modelTrainingRun.update({
        where: { id },
        data: {
          status: 'RUNNING',
          containerId: container.id,
          startedAt: new Date(),
        },
      });
    }

    void this.watch(id, container, mode);
  }

  /**
   * Observe the exit code.
   *
   * The container reports its own outcome via /complete (train),
   * /score-complete (score), or /batch-complete (batch), but a process that
   * is OOM-killed or segfaults never gets to. Without this, such a run
   * stays RUNNING (train, batch) or "scoring" (score) forever. A real
   * report having already landed always wins — this only fills a gap, it
   * does not overrule one.
   */
  private async watch(
    id: string,
    container: Docker.Container,
    mode: 'train' | 'score' | 'batch' | 'infer' = 'train',
  ) {
    try {
      const { StatusCode } = await container.wait();

      if (mode === 'score') {
        const run = await this.prisma.modelTrainingRun.findUnique({
          where: { id },
          select: { scoringContainerId: true },
        });
        // Already cleared by a real /score-complete (or a later re-trigger's
        // own container) — this exit report is stale, do not clobber it.
        if (!run || run.scoringContainerId !== container.id) return;

        const tail = await this.tailLogs(container);
        await this.prisma.modelTrainingRun.update({
          where: { id },
          data: { scoringContainerId: null },
        });
        await this.prisma.modelTrainingRunLog.create({
          data: {
            runId: id,
            level: 'error',
            message: (StatusCode === 0
              ? `Scoring container exited 0 without reporting a result. Tail: ${tail}`
              : `Scoring container exited ${StatusCode}. Tail: ${tail}`
            ).slice(0, 4000),
          },
        });
        return;
      }

      if (mode === 'batch') {
        const job = await this.prisma.predictionJob.findUnique({
          where: { id },
          select: { status: true },
        });
        // Same "a real report already landed always wins" rule as train —
        // a stale exit report for a job already terminal (via a real
        // /batch-complete) must not clobber the recorded outcome.
        if (job && (job.status === 'RUNNING' || job.status === 'QUEUED')) {
          const tail = await this.tailLogs(container);
          await this.prisma.predictionJob.update({
            where: { id },
            data: {
              status: 'FAILED',
              failureReason:
                StatusCode === 0
                  ? `Container exited 0 without reporting a result. Tail: ${tail}`
                  : `Container exited ${StatusCode}. Tail: ${tail}`,
              finishedAt: new Date(),
            },
          });
        }
        return;
      }

      if (mode === 'infer') {
        const window = await this.prisma.inferenceWindow.findUnique({
          where: { id },
          select: { status: true },
        });
        // Same "a real report already landed always wins" rule as batch —
        // a stale exit report for a window already terminal (via a real
        // /infer-complete, or T02's own stuck-window reconcile) must not
        // clobber the recorded outcome.
        if (
          window &&
          (window.status === 'RUNNING' || window.status === 'PENDING')
        ) {
          const tail = await this.tailLogs(container);
          await this.prisma.inferenceWindow.update({
            where: { id },
            data: {
              status: 'FAILED',
              failureReason:
                StatusCode === 0
                  ? `Container exited 0 without reporting a result. Tail: ${tail}`
                  : `Container exited ${StatusCode}. Tail: ${tail}`,
              finishedAt: new Date(),
              tokenExpiresAt: new Date(0),
            },
          });
        }
        return;
      }

      const run = await this.prisma.modelTrainingRun.findUnique({
        where: { id },
        select: { status: true },
      });
      if (run && (run.status === 'RUNNING' || run.status === 'QUEUED')) {
        const tail = await this.tailLogs(container);
        await this.prisma.modelTrainingRun.update({
          where: { id },
          data: {
            status: 'FAILED',
            failureReason:
              StatusCode === 0
                ? `Container exited 0 without reporting a result. Tail: ${tail}`
                : `Container exited ${StatusCode}. Tail: ${tail}`,
            finishedAt: new Date(),
          },
        });
      }
    } catch (err) {
      this.log.error(`watch failed for run ${id} (${mode})`, err);
    } finally {
      await this.reap(container, false);
    }
  }

  private async tailLogs(container: Docker.Container): Promise<string> {
    try {
      const buf = await container.logs({
        stdout: true,
        stderr: true,
        tail: 40,
      });
      return buf.toString('utf8').slice(-2000);
    } catch {
      return '(logs unavailable)';
    }
  }

  private async reap(container: Docker.Container, failed: boolean) {
    if (failed && process.env.TRAINING_KEEP_FAILED === '1') return;
    try {
      await container.remove({ force: true });
    } catch {
      /* already gone */
    }
  }

  async kill(containerId: string) {
    try {
      await this.docker.getContainer(containerId).kill();
    } catch (err) {
      this.log.warn(`kill ${containerId}: ${(err as Error).message}`);
    }
  }

  /**
   * MODEL-SERVE-006. Exposed for InferenceWindowSchedulerService's own
   * timeout-based stuck-window reconcile — the same `container.inspect()`
   * existence check `reconcileOrphanedRuns` already performs inline, made
   * public rather than duplicated a second time with `getContainer` +
   * `inspect` repeated in a different file.
   */
  async containerExists(containerId: string): Promise<boolean> {
    try {
      await this.docker.getContainer(containerId).inspect();
      return true;
    } catch {
      return false;
    }
  }
}
