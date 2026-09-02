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

  // 1.0.2: build_model widened from 3 branches (ols/ridge/hgb) to 10 —
  // TrainingAlgorithmEnum now allows all 10, so the default image MUST
  // agree or every other algorithm passes validation, spawns a container,
  // downloads and checksums the artifact, and only then dies on
  // "Unsupported algorithm" (images/trainer/train.py). Bump this default
  // alongside any future build_model change that isn't purely additive.
  //
  // 1.0.3 (MODEL-FLOW-007-T11): purely additive, not a build_model change —
  // run_manifest.json gained a `framework_versions` field. Bumped anyway,
  // for the same reason `image_digest` is recorded on every run at all:
  // provenance. A pre-1.0.3 run's manifest simply lacks the field — every
  // reader treats it as optional, so nothing branches on this tag.
  //
  // 1.0.4 (MODEL-FLOW-009-T04): build_model widened again — lstm/gru now
  // construct a real SequenceRegressor (sequence_model.py, torch) instead
  // of raising. Same rule as the 1.0.2 bump: TrainingAlgorithmEnum now
  // allows lstm/gru, so the default image MUST agree or a run passes
  // validation, spawns a container, and only then dies inside it.
  //
  // 1.0.5 (MODEL-FLOW-016-T03/T07): TWO main()-path changes in one bump, on
  // purpose — bumping twice would leave a window where a scoring container
  // runs a CV-only image. (a) train.py handles splitSpec.method
  // 'cv_expanding' (k expanding folds + a refit, cv_folds.json, no
  // predictions.parquet); (b) a MODE=score entrypoint (run_score) that
  // reloads model.joblib and scores the validation holdout. Same rule as
  // the 1.0.2/1.0.4 bumps: the DTO now accepts nSplits and this service
  // now spawns with MODE=score, so the default image MUST agree or a run
  // passes validation, spawns, and only then dies inside the container.
  // Both paths verified against this exact tag before the bump landed —
  // MODE=score reaches /score-claim, /score-log, /score-complete and NEVER
  // a training endpoint (including on its crash path); MODE unset still
  // reaches /log and /complete.
  private readonly imageRef =
    process.env.TRAINING_IMAGE ?? 'scgc/soft-sensor-trainer:1.0.5';
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
   * MODEL-FLOW-016-T07. `mode` parameterizes ONE spawn path rather than a
   * near-copy `spawnScore` — the HostConfig below is ~25 lines of
   * security-critical settings (CapDrop, ReadonlyRootfs, Tmpfs, memory
   * caps); two copies is how they drift out of sync with each other.
   * `train-${runId}` and `score-${runId}` are deliberately DIFFERENT
   * container names — the training container has already exited by the
   * time scoring starts (see `claim()`'s doc comment), but a stale name
   * collision would still be possible if the training container were ever
   * kept (`TRAINING_KEEP_FAILED=1`).
   */
  async spawn(runId: string, token: string, mode: 'train' | 'score' = 'train') {
    const container = await this.docker.createContainer({
      Image: this.imageDigest || this.imageRef,
      name: `${mode}-${runId}`,
      Env: [
        `RUN_ID=${runId}`,
        `RUN_TOKEN=${token}`,
        `API_BASE=${process.env.INTERNAL_API_BASE ?? 'http://backend:3000'}`,
        `MODE=${mode}`,
      ],
      Labels: {
        'dslake.role': mode === 'score' ? 'scoring' : 'training',
        'dslake.runId': runId,
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
    // admitted) QUEUED window it currently has.
    if (mode === 'score') {
      await this.prisma.modelTrainingRun.update({
        where: { id: runId },
        data: { scoringContainerId: container.id },
      });
      await container.start();
    } else {
      await container.start();
      await this.prisma.modelTrainingRun.update({
        where: { id: runId },
        data: {
          status: 'RUNNING',
          containerId: container.id,
          startedAt: new Date(),
        },
      });
    }

    void this.watch(runId, container, mode);
  }

  /**
   * Observe the exit code.
   *
   * The container reports its own outcome via /complete (train) or
   * /score-complete (score), but a process that is OOM-killed or segfaults
   * never gets to. Without this, such a run stays RUNNING (train) or
   * "scoring" (score) forever. A real report having already landed always
   * wins — this only fills a gap, it does not overrule one.
   */
  private async watch(
    runId: string,
    container: Docker.Container,
    mode: 'train' | 'score' = 'train',
  ) {
    try {
      const { StatusCode } = await container.wait();

      if (mode === 'score') {
        const run = await this.prisma.modelTrainingRun.findUnique({
          where: { id: runId },
          select: { scoringContainerId: true },
        });
        // Already cleared by a real /score-complete (or a later re-trigger's
        // own container) — this exit report is stale, do not clobber it.
        if (!run || run.scoringContainerId !== container.id) return;

        const tail = await this.tailLogs(container);
        await this.prisma.modelTrainingRun.update({
          where: { id: runId },
          data: { scoringContainerId: null },
        });
        await this.prisma.modelTrainingRunLog.create({
          data: {
            runId,
            level: 'error',
            message: (StatusCode === 0
              ? `Scoring container exited 0 without reporting a result. Tail: ${tail}`
              : `Scoring container exited ${StatusCode}. Tail: ${tail}`
            ).slice(0, 4000),
          },
        });
        return;
      }

      const run = await this.prisma.modelTrainingRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (run && (run.status === 'RUNNING' || run.status === 'QUEUED')) {
        const tail = await this.tailLogs(container);
        await this.prisma.modelTrainingRun.update({
          where: { id: runId },
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
      this.log.error(`watch failed for run ${runId} (${mode})`, err);
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
}
