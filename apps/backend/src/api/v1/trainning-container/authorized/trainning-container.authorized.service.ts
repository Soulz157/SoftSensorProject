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
  //
  // 1.0.6 (MODEL-SERVE-003): MODE=batch entrypoint added (pipelines/batch.py)
  // — reaches /batch-claim, /batch-log, /batch-complete and never a training
  // or score endpoint. Same rule as every prior bump: this service now spawns
  // batch jobs with MODE=batch, so the default image MUST carry batch.py or a
  // job passes validation, spawns, and dies inside the container on the old
  // train.py's MODE dispatch (no such branch existed before this tag).
  // Verified against this exact tag before the bump landed: images/trainer's
  // own pytest suite (27/27) plus a live in-container run against real
  // fitted-model + parquet fixtures.
  //
  // 1.0.7 (MODEL-FLOW-019-T09): purely additive, bumped for the reason 1.0.3
  // was — a new artifact, not a new mode. `_publish` now writes
  // feature_importance.json (importance.py) for the algorithms carrying a
  // readable importance; every other algorithm writes nothing, as before.
  // No DTO or enum widened, so unlike the 1.0.2/1.0.4/1.0.5/1.0.6 bumps a
  // stale image here does NOT kill a run — it is a SILENT no-op, which is
  // why this bump was easy to forget and was forgotten: 1.0.6 was built
  // 2026-09-02, importance.py landed 2026-09-08, and every run in between
  // recorded featureImportanceKey null while Step 5 honestly read "not
  // recorded for this run" against working code on both sides of it.
  // Verified against this exact tag before the bump landed, in-image and
  // measured rather than dated: `from importance import
  // extract_feature_importance` raises ModuleNotFoundError on 1.0.6 and
  // imports on 1.0.7, and a real fitted RandomForestRegressor through the
  // image's own extract_feature_importance returns the documented
  // {algorithm, method, standardized, scaling_methods, features[]} shape.
  // images/trainer's pytest suite is NOT runnable in-image (the test/ tree
  // and pytest itself are excluded from the build), so suite-level evidence
  // for importance.py remains T09's own throwaway-venv run, 12/12.
  //
  // "PURELY ADDITIVE" IS A MEASURED CLAIM HERE, NOT AN ASSUMPTION — a rebuild
  // ships whatever the tree holds, so the whole 1.0.6..1.0.7 delta was
  // checked, not just this task's own commit. Three commits touched
  // images/trainer/app after 1.0.6's build: 4f20227 (MODE=batch), 8d1d59d
  // (models.py, COMMENT-ONLY — the MIRRORS.md entry-5 note on the grp
  // row-count guard, no behavior), and e9fcdf6 (this feature). 4f20227 is
  // the subtle one: it is dated 2026-09-03, AFTER 1.0.6's 2026-09-02 build,
  // which would mean 1.0.6 lacks batch.py and every MODE=batch job has been
  // dying inside the container. It does not — `ls pipelines/` inside 1.0.6
  // shows batch.py present, i.e. 1.0.6 was built from that working tree the
  // evening before it was committed. So the only BEHAVIORAL change 1.0.7
  // adds over 1.0.6 is importance.py plus its artifacts.py constant and
  // _publish wiring.
  //
  // 1.0.8 (MODEL-FLOW-019-T20): score.py's OWN upload filename changed —
  // not additive like 1.0.3/1.0.7, closer to the 1.0.5 shape. Scoring was
  // CV-only through 1.0.7 (predictions.parquet only, since a CV run never
  // has one already); this service now also triggers it for a non-CV run,
  // whose predictions.parquet already holds its TEST split. score.py reads
  // `spec["isCvRun"]` (scoreClaimService's new field) and uploads
  // predictions.parquet for a CV run, holdout_predictions.parquet
  // otherwise — a stale pre-1.0.8 image would upload predictions.parquet
  // for EVERY scored run regardless of kind, silently destroying a non-CV
  // run's own test-split predictions the moment its first score completes.
  // Verified against this exact tag before the bump landed, in-image:
  // `docker run --entrypoint python <tag>:1.0.8 -c "from artifacts import
  // HOLDOUT_PREDICTIONS_FILENAME"` imports cleanly and `inspect.getsource
  // (run_scoring)` shows the isCvRun branch present. images/trainer's own
  // pytest suite is not runnable in-image (see the 1.0.7 note above); no
  // trainer-level test exists for score.py specifically at this tag.
  //
  // 1.0.9 (MODEL-FLOW-019-T31 + T32): TWO changes in one bump, both purely
  // ADDITIVE and therefore in the SILENT class the 1.0.7 note above exists to
  // record — a stale image yields a null key and an honest absence sentence,
  // indistinguishable on screen from the legacy path. One bump for both, per
  // MODEL-FLOW-016-T07's rule of one bump per sequencing.
  //
  //   T32 — importance.py's `standardized` predicate CORRECTED, plus the new
  //   `standardized-coefficient` method. The old predicate read
  //   `bool(feature_spec["scaling"])`, the trap packages/py-scaling's own
  //   `assert_scaling_coverage` documents: `scaling` holds an entry only for
  //   an EXPLICIT scaler choice, while `to_model_ready` defaults every
  //   unlisted tag to minmax and records what it fitted in `scalingParams`.
  //   Measured 2026-09-09 across all five feature specs in the dev DB: every
  //   one has `scaling: []`, four carry 22 populated `scalingParams` and one
  //   carries none — so EVERY coefficient run read "not ranked", scaled or
  //   not. Coverage is now checked per feature column against
  //   `scalingParams`. The reverse exposure is worth stating: on a stale
  //   image a scaled linear run keeps reading "not ranked", which is the
  //   status quo, never a wrong ranking.
  //
  //   T31 — the run spec's optional `featureColumns` restricts training to a
  //   named subset and REFUSES a column the artifact lacks rather than
  //   intersecting. A stale image IGNORES the field and trains on every
  //   column, so a sweep row would record feature_count = 21 while its
  //   request claimed n = 4. That is the one non-silent consequence here: the
  //   table reads each row's `n` from the run's OWN recorded feature_count,
  //   so such rows land on the curve at 21 rather than masquerading as the
  //   count they asked for.
  //
  // Verified against this exact tag before the bump landed, in-image, the
  // same discipline the 1.0.8 note applies: `docker run --entrypoint python
  // <tag>:1.0.9` imports importance/pipelines.context and confirms
  // `standardized-coefficient`, the `scalingParams` predicate, `feature_std`,
  // `resolve_feature_columns` and TrainingResult's `train_feature_std` field
  // all present; a real Ridge fit returns method `standardized-coefficient`
  // with figures equal to |coef| * std(X), the live scaled shape (`scaling:
  // []` with populated `scalingParams`) now ranks as plain `coefficient`
  // naming minmax, and a run with no coverage and no width is STILL refused
  // (AC27 intact). images/trainer's pytest suite is not runnable in-image
  // (see the 1.0.7 note); it passes on the host at 53 tests.
  //
  // PUSH PENDING AT THE TIME THIS LANDED — `docker push` returned
  // `insufficient_scope: authorization failed` for this registry, so 1.0.9
  // exists LOCALLY on the machine that built it and not yet in the registry.
  // `resolveDigest` below inspects the local image first and pulls only when
  // it is absent, so this default is correct where it was built and fails
  // LOUDLY at boot elsewhere (a warn, then a rejected pull) rather than
  // silently running old code. Push the tag to close that gap.
  //
  // 1.0.10 (MODEL-FLOW-019-T26): purely ADDITIVE, and therefore in the SILENT
  // class the 1.0.7 note above exists to record — a stale image yields a null
  // key and an honest absence sentence, indistinguishable on screen from the
  // legacy path. A NON-CV run now writes `holdout_predictions.parquet` INLINE
  // at training time: `_score_holdout_if_present` already computed the
  // per-row holdout frame and bound it to `_`, discarding it, which is the
  // single reason 0 of 252 SUCCEEDED runs carried a holdout SERIES while 188
  // carried a holdout AGGREGATE. Nothing else changed — no second predict
  // pass, no model reload, no new dependency, and CV is untouched
  // (`holdout_eligible` is False there, so its holdout still arrives through
  // score.py). Cost is one parquet write plus one PUT.
  //
  // WHY 1.0.10 AND NOT 1.0.9, since T26's own ledger detail says 1.0.8 ->
  // 1.0.9: 1.0.9 was already taken by T31+T32 and its note above records a
  // specific in-image verification for THAT content. Rebuilding 1.0.9 with a
  // third task's change would falsify a record that already claims to have
  // been verified, so the bump goes forward instead of being reused.
  //
  // Verified against this exact tag before the bump landed, in-image, the
  // same discipline the 1.0.8/1.0.9 notes apply — by SOURCE and by BEHAVIOUR,
  // not by tag: `docker run --entrypoint python <tag>:1.0.10` confirms
  // `HOLDOUT_PREDICTIONS_FILENAME` reaches `_publish`, `_publish` carries a
  // `holdout_predictions` parameter, and `_score_holdout_if_present` returns
  // the PAIR (`holdout_metrics, _ =` is gone). Functionally, a stub estimator
  // through `score_holdout` returns a {timestamp,y_true,y_pred} frame of 4
  // rows from a 5-row holdout with one unlabelled row, and that frame
  // round-trips through `ArtifactSet.add_parquet` at 2,638 bytes.
  //
  // CORRECTION TO THE 1.0.7/1.0.9 NOTES ABOVE: images/trainer's pytest suite
  // IS runnable in-image, contrary to what those notes assert. It needs
  // `--user root` (the image runs as `trainer`, so the pip install is
  // otherwise silently ineffective) plus `pip install pytest`, with the test
  // directory mounted. Measured at this tag: 55 passed (53 inherited, 2 added
  // by T26). Recorded because that claim has been repeated across three bump
  // notes and sent every prior verification to the host unnecessarily.
  //
  // PUSH FAILED, SAME AS 1.0.9 — `docker push` returned `insufficient_scope:
  // authorization failed`, so 1.0.10 exists LOCALLY on the machine that built
  // it and not in the registry. Every environment other than that machine
  // fails LOUDLY at boot (a warn, then a rejected pull) rather than silently
  // running old code. Push the tag to close the gap.
  private readonly imageRef =
    process.env.TRAINING_IMAGE ?? 'scgc/soft-sensor-trainer:1.0.10';
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
    mode: 'train' | 'score' | 'batch' = 'train',
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
    mode: 'train' | 'score' | 'batch' = 'train',
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
}
