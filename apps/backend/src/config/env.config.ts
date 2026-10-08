export const env = {
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN!,
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES!,
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES!,
  // Base URL of the FastAPI data-connector service (server-side only).
  PYTHON_API_URL: process.env.PYTHON_API_URL ?? 'http://localhost:8000',
  // 32-byte key (base64 or hex) for AES-256-GCM Data Source secret encryption.
  DATASOURCE_ENCRYPTION_KEY: process.env.DATASOURCE_ENCRYPTION_KEY!,

  // DS-LAKE-009B: intermediate-artifact cleanup retention windows, in hours.
  //
  // Two windows, not one, because they gate two different eligibility paths
  // (see ArtifactCleanupService):
  //   - CLEANUP_DRAFT_RECOVERY_HOURS: how long an ABANDONED draft's own
  //     artifacts (a wizard run that was never saved) stay recoverable after
  //     abandonment, measured from DatasetDraft.updatedAt at the ABANDONED
  //     transition. Marking ABANDONED is normally an explicit user action
  //     (abandonDraftService), but DS-LAKE-014 also auto-abandons an ACTIVE
  //     draft that owns zero live artifacts past CLEANUP_ACTIVE_EMPTY_MINUTES
  //     — see below. Either path lands here on the same clock.
  //   - CLEANUP_INTERMEDIATE_RETENTION_HOURS: how long a SAVED draft's
  //     leftover BRONZE/SILVER/GOLD siblings (everything except the adopted
  //     FINAL) stay available for audit/retry after Save, measured from
  //     DatasetDraft.updatedAt at Save time (NOT DatasetArtifact.createdAt —
  //     using the artifact's own write time was a real bug caught before
  //     ship, see artifact-cleanup-eligibility.ts's CleanupDraftInfo doc
  //     comment). Per decisions.reproducibility_anchor, a BRONZE reachable
  //     through a non-ARCHIVED DatasetVersion's parentArtifactId chain is
  //     pinned regardless of this value — the window only ever releases
  //     SILVER/GOLD, or a BRONZE that is not (or no longer) reachable that
  //     way.
  // Both default to 7 days.
  CLEANUP_DRAFT_RECOVERY_HOURS: Number(
    process.env.CLEANUP_DRAFT_RECOVERY_HOURS ?? 168,
  ),
  CLEANUP_INTERMEDIATE_RETENTION_HOURS: Number(
    process.env.CLEANUP_INTERMEDIATE_RETENTION_HOURS ?? 168,
  ),

  // DS-LAKE-014: gives the DS-LAKE-009B cleanup mechanism a caller and closes
  // the ACTIVE-draft hole (`selectCleanupEligibleArtifacts` used to skip
  // every ACTIVE draft unconditionally, so a closed wizard tab leaked its
  // artifacts forever). TIERED, not one blanket window, because the two
  // cases have very different costs to get wrong:
  //   - CLEANUP_ACTIVE_EMPTY_MINUTES: an ACTIVE draft owning ZERO live
  //     artifacts — nothing was fetched, nothing is expensive to lose. This
  //     is a DRAFT-LEVEL status transition to ABANDONED (no MinIO object,
  //     nothing for the artifact-keyed predicate to act on), gated on
  //     `updatedAt` past this window with no live artifact. Once ABANDONED
  //     it rejoins CLEANUP_DRAFT_RECOVERY_HOURS above like any other
  //     abandoned draft.
  //   - CLEANUP_ACTIVE_IDLE_HOURS: an ACTIVE draft that DOES own a live
  //     artifact — a real PI fetch cost minutes, and an engineer may return
  //     to it after a meeting. Read by `selectCleanupEligibleArtifacts`'s
  //     ACTIVE branch directly (reclaims the artifact's MinIO bytes once
  //     past this window, same as the SAVED/ABANDONED branches).
  //   - CLEANUP_SWEEP_INTERVAL_MS: how often ArtifactCleanupAdminService's
  //     boot-registered setInterval calls run({ dryRun: false }) on its own.
  //     `<= 0` disables the sweep entirely; the admin endpoint keeps working
  //     unchanged either way.
  // Both age windows measure from DatasetDraft.updatedAt, matching the
  // SAVED/ABANDONED branches' own convention — see T04's wizard heartbeat
  // (`POST /authorized/dataset-drafts/:id/touch`) for how that clock stays
  // honest while a wizard tab is genuinely open but issuing no writes.
  CLEANUP_ACTIVE_EMPTY_MINUTES: Number(
    process.env.CLEANUP_ACTIVE_EMPTY_MINUTES ?? 15,
  ),
  CLEANUP_ACTIVE_IDLE_HOURS: Number(process.env.CLEANUP_ACTIVE_IDLE_HOURS ?? 6),
  CLEANUP_SWEEP_INTERVAL_MS: Number(
    process.env.CLEANUP_SWEEP_INTERVAL_MS ?? 300_000,
  ),

  // MODEL-FLOW-011: the ModelDraft-side twin of the DS-LAKE-014 block above.
  // ModelDraft has no artifact of its own — its ModelTrainingRuns write
  // under drafts/{modelDraftId}/runs/{runId}/ instead (MODEL-FLOW-003-T08)
  // — so the tiers here gate a DRAFT-LEVEL status transition to ABANDONED
  // plus a run-prefix reclaim, not an artifact-level reclaim.
  //   - MODEL_DRAFT_EMPTY_IDLE_HOURS: an ACTIVE draft owning ZERO
  //     ModelTrainingRuns — nothing was computed, nothing is expensive to
  //     lose. Longer than CLEANUP_ACTIVE_EMPTY_MINUTES's 15 minutes on
  //     purpose: an abandoned draft drops off the Step 1 "Drafts in
  //     progress" resume panel (MODEL-FLOW-010-T08), so this window is the
  //     whole grace period before that panel forgets a user's work, not
  //     just before bytes are freed. Default 24 hours.
  //   - MODEL_DRAFT_RUNS_IDLE_HOURS: an ACTIVE draft that owns at least one
  //     run — a real fit cost minutes of container time. Matches
  //     CLEANUP_DRAFT_RECOVERY_HOURS' 168-hour figure. A draft with any run
  //     QUEUED/RUNNING, or any ModelCandidateJob QUEUED/RUNNING, is never
  //     eligible under this window regardless of `updatedAt` age — a run in
  //     flight never touches ModelDraft.updatedAt, so without that check a
  //     slow fit inside this window would be reclaimable mid-flight.
  //   - MODEL_DRAFT_ABANDONED_RECOVERY_HOURS: an ABANDONED draft (via the
  //     tier above, or the user's own Remove button —
  //     ModelDraftAuthorizedService.abandonDraftService) whose run objects
  //     have not yet been reclaimed (objectsReclaimedAt still null). Gives a
  //     just-abandoned draft's bytes the same recovery grace
  //     CLEANUP_DRAFT_RECOVERY_HOURS gives a DatasetDraft's.
  //   - MODEL_DRAFT_SWEEP_INTERVAL_MS: ModelDraftCleanupAdminService's own
  //     boot-registered setInterval, independent of CLEANUP_SWEEP_INTERVAL_MS
  //     — one sweeper per entity, matching how DS-LAKE-014's sweeper never
  //     touches ModelDraft. `<= 0` disables the sweep; the admin endpoint
  //     keeps working unchanged either way.
  // All three age windows measure from ModelDraft.updatedAt.
  MODEL_DRAFT_EMPTY_IDLE_HOURS: Number(
    process.env.MODEL_DRAFT_EMPTY_IDLE_HOURS ?? 24,
  ),
  MODEL_DRAFT_RUNS_IDLE_HOURS: Number(
    process.env.MODEL_DRAFT_RUNS_IDLE_HOURS ?? 168,
  ),
  MODEL_DRAFT_ABANDONED_RECOVERY_HOURS: Number(
    process.env.MODEL_DRAFT_ABANDONED_RECOVERY_HOURS ?? 168,
  ),
  MODEL_DRAFT_SWEEP_INTERVAL_MS: Number(
    process.env.MODEL_DRAFT_SWEEP_INTERVAL_MS ?? 300_000,
  ),

  // MODEL-SERVE-002. Shared secret the apps/serving process presents to
  // reach the descriptor endpoints (`ServingTokenGuard`) — not a JWT,
  // because JwtAccessStrategy's `validate()` carries an unconditional
  // 100ms delay (strategies/jwt-access.strategy.ts) that has no business
  // being on a path whose whole point is being bounded, and a serving
  // process is not a logged-in user. No default: an unset token must fail
  // closed, never silently accept every bearer value.
  SERVING_API_TOKEN: process.env.SERVING_API_TOKEN,

  // MODEL-SERVE-008-T02. The FIRST outbound backend -> serving call in this
  // system: SERVING_API_TOKEN above only VERIFIES traffic arriving FROM the
  // serving process, and until the live-prediction driver every call ran in
  // that direction. apps/serving's /predict carries no auth of its own (it
  // is an internal service reached over the compose network), so this is a
  // base URL and not a credential — nothing here fails closed, because
  // there is nothing to fail closed ON.
  SERVING_API_URL: process.env.SERVING_API_URL ?? 'http://localhost:8100',

  // How often the driver WAKES, which is not how often a model is scored:
  // each schedule carries its own `livePredictCadenceMinutes` (default 10,
  // floored by the slowest tag's real refresh — see schema.prisma) and the
  // sweep simply asks who is due. Same split `INFERENCE_TICK_INTERVAL_MS`
  // already draws between the dispatch sweep and a schedule's own cadence,
  // and the same reason MODEL-SERVE-001-T09 gave for not polling faster
  // than the tick: anything shorter is load with no information in it.
  LIVE_PREDICT_TICK_INTERVAL_MS: Number(
    process.env.LIVE_PREDICT_TICK_INTERVAL_MS ?? 60_000,
  ),

  // MODEL-SERVE-028 removed LIVE_DRIFT_CONSECUTIVE_BREACHES, DRIFT_WARN_SD
  // and DRIFT_CRITICAL_SD with the z-score mean-shift drift signal. PSI
  // (below) is the only input-drift metric.

  // MODEL-SERVE-001-T13. PSI thresholds — 0.1/0.25 are the CONVENTIONAL
  // credit-scoring cutoffs (commonly cited: <0.1 stable, 0.1-0.25 moderate
  // shift, >0.25 major shift), never measured against this project's own
  // process data (T13's own explicit warning: writing these on screen as
  // if measured would be "a guess wearing a formula", the exact defect
  // MODEL-FLOW-020's finding 3 names) — the UI must label them as
  // convention, not fact. PSI_MIN_SAMPLES_PER_BIN is T13's own resolved
  // openDecision #2: below `binCount * PSI_MIN_SAMPLES_PER_BIN` live
  // samples, a PSI figure is not published at all (INSUFFICIENT_DATA,
  // never a numeric value at noise-level sample sizes).
  PSI_WARN: Number(process.env.PSI_WARN ?? 0.1),
  PSI_CRITICAL: Number(process.env.PSI_CRITICAL ?? 0.25),
  PSI_MIN_SAMPLES_PER_BIN: Number(process.env.PSI_MIN_SAMPLES_PER_BIN ?? 20),
  // MODEL-SERVE-029. Out-of-range grading — the share of live samples
  // (percent of liveTotal) outside a tag's frozen trained edges, graded by
  // its own rule beside PSI because PSI's formula cannot see that mass at
  // all (the reference has no below/above bin to compare against). 5/20
  // are a CONVENTIONAL starting point chosen 2026-10-05, not measured
  // against this plant's data — label them as convention, like PSI_WARN.
  PSI_OUT_OF_RANGE_WARN_PCT: Number(process.env.PSI_OUT_OF_RANGE_WARN_PCT ?? 5),
  PSI_OUT_OF_RANGE_CRITICAL_PCT: Number(
    process.env.PSI_OUT_OF_RANGE_CRITICAL_PCT ?? 20,
  ),

  // MODEL-SERVE-006. The scheduler tick — same `<= 0` disables / `.unref()`
  // shape ModelDraftCleanupAdminService's own MODEL_DRAFT_SWEEP_INTERVAL_MS
  // uses. The tick only inserts PENDING rows and reconciles stuck RUNNING
  // ones; it never scores anything itself (see InferenceWindowScheduler
  // Service's own doc comment for why that split is load-bearing).
  INFERENCE_TICK_INTERVAL_MS: Number(
    process.env.INFERENCE_TICK_INTERVAL_MS ?? 300_000,
  ),
  // Per-model defaults when a schedule doesn't set its own — T04's own
  // ingestion lag is NEVER zero and NEVER derived from the cadence; 15 is a
  // CHOSEN default (PI unreachable from dev to measure worst-case tag
  // arrival — see MODEL-SERVE-006-V08), not a measured one.
  INFERENCE_DEFAULT_CADENCE_MINUTES: Number(
    process.env.INFERENCE_DEFAULT_CADENCE_MINUTES ?? 60,
  ),
  INFERENCE_DEFAULT_LAG_MINUTES: Number(
    process.env.INFERENCE_DEFAULT_LAG_MINUTES ?? 15,
  ),
  // How far back the tick backfills on its own, every tick — bounded so a
  // schedule enabled after a long outage does not try to insert years of
  // windows in one pass. Manual backfill (POST /inference/backfill) is
  // unbounded by this and takes an explicit range instead.
  INFERENCE_BACKFILL_HORIZON_HOURS: Number(
    process.env.INFERENCE_BACKFILL_HORIZON_HOURS ?? 48,
  ),
  // Containers spawned per tick, across all schedules — bounds a first
  // boot with a long backfill horizon from spawning dozens at once.
  INFERENCE_MAX_CONCURRENCY: Number(process.env.INFERENCE_MAX_CONCURRENCY ?? 1),
  // Below this row count (post drop_bad_feature_rows), a window is SKIPPED
  // rather than scored — a real terminal status, not a synonym for FAILED
  // (T01's own finding). Default is half an hourly window at the observed
  // dataset's 1-minute interval (60 rows/hour); NOT 1, which would make
  // SKIPPED practically unreachable.
  INFERENCE_MIN_ROWS: Number(process.env.INFERENCE_MIN_ROWS ?? 15),
  // T10: no window reaching SUCCEEDED or SKIPPED for this many cadences
  // raises the staleness alarm. SKIPPED counts — it proves the record is
  // still being written — but never counts as a live prediction either.
  INFERENCE_STALE_AFTER_CADENCES: Number(
    process.env.INFERENCE_STALE_AFTER_CADENCES ?? 3,
  ),
  // A RUNNING window whose startedAt is older than this is reconciled to
  // FAILED at the next tick — the first timeout-based reconcile in this
  // codebase (reconcileOrphanedRuns's existence check has no clock at all;
  // see this feature's own plan for why a PENDING->RUNNING gap of a whole
  // tick interval needs one that batch/training's sub-second gap does not).
  INFERENCE_WINDOW_STUCK_MS: Number(
    process.env.INFERENCE_WINDOW_STUCK_MS ?? 30 * 60 * 1000,
  ),
  // Same TTL shape as PREDICTION_JOB_TOKEN_TTL_MS — bounded work, not an
  // open-ended fit.
  INFERENCE_WINDOW_TOKEN_TTL_MS: Number(
    process.env.INFERENCE_WINDOW_TOKEN_TTL_MS ?? 2 * 60 * 60 * 1000,
  ),

  // MODEL-SERVE-005-T03. The ground-truth join runs on its OWN sweep, not
  // inside the scheduler tick — MODEL-SERVE-006-T02's rule is that the tick
  // inserts windows and reconciles, nothing else. `<= 0` disables, the same
  // shape as every other sweep in this codebase.
  //
  // Slower than the scheduler tick on purpose: truth arrives on a lag
  // measured in HOURS (InferenceSchedule.truthLagMinutes defaults to a
  // day), so a faster sweep would re-ask the same sources for rows that
  // cannot have changed yet.
  INFERENCE_TRUTH_SWEEP_INTERVAL_MS: Number(
    process.env.INFERENCE_TRUTH_SWEEP_INTERVAL_MS ?? 15 * 60 * 1000,
  ),
  // Windows joined per sweep, across all schedules. Each join is a real
  // fetch against a source system plus an object read and write, so this
  // bounds what one pass can cost a historian.
  INFERENCE_TRUTH_BATCH_SIZE: Number(
    process.env.INFERENCE_TRUTH_BATCH_SIZE ?? 25,
  ),
  // Backoff base after a join that added no new truth. Without it, every
  // window inside its `truthHorizonHours` would be re-fetched on EVERY
  // sweep until that horizon elapsed — ~168 round trips per window at the
  // default horizon — nearly all returning rows already held. Doubles per
  // idle attempt; the horizon itself is what finally ends re-joining.
  INFERENCE_TRUTH_RETRY_BACKOFF_MINUTES: Number(
    process.env.INFERENCE_TRUTH_RETRY_BACKOFF_MINUTES ?? 180,
  ),

  // MODEL-SERVE-022. The transition-evaluator sweep — same `<= 0` disables
  // / `.unref()` shape every other sweep here uses. Bounded per sweep by
  // NOTIFY_EVAL_MAX_PER_SWEEP (T01: getHealthStatus is ~6-8 queries/model,
  // the same cost the Model Detail page already pays per load; this bounds
  // what one sweep can cost when many schedules are enabled at once).
  NOTIFY_EVAL_INTERVAL_MS: Number(
    process.env.NOTIFY_EVAL_INTERVAL_MS ?? 300_000,
  ),
  NOTIFY_EVAL_MAX_PER_SWEEP: Number(
    process.env.NOTIFY_EVAL_MAX_PER_SWEEP ?? 50,
  ),
  // The delivery drain sweep — separate interval from the evaluator above,
  // same reason the truth sweeper and the scheduler tick are separate: one
  // sweep enqueues facts, a different one spends network time sending them,
  // so a slow SMTP server or a dead Teams endpoint never delays the other.
  NOTIFY_DELIVERY_INTERVAL_MS: Number(
    process.env.NOTIFY_DELIVERY_INTERVAL_MS ?? 30_000,
  ),
  NOTIFY_DELIVERY_MAX_ATTEMPTS: Number(
    process.env.NOTIFY_DELIVERY_MAX_ATTEMPTS ?? 5,
  ),
  NOTIFY_SEND_TIMEOUT_MS: Number(process.env.NOTIFY_SEND_TIMEOUT_MS ?? 10_000),

  // The link a notification points at (models/[id]) — the first env var this
  // codebase has needed for "where does the frontend live", since every
  // prior backend->client reference was a relative path rendered client-side.
  CLIENT_APP_URL: process.env.CLIENT_APP_URL ?? 'http://localhost:3000',

  // MODEL-SERVE-022-T02-addendum. NotificationEvent retention — user
  // decision 2026-09-29: 90 days. Own sweep, `<= 0` disables (retention
  // days `<= 0` also skips the delete, belt-and-braces against a
  // misconfigured 0 wiping every event on the next tick).
  NOTIFY_EVENT_RETENTION_DAYS: Number(
    process.env.NOTIFY_EVENT_RETENTION_DAYS ?? 90,
  ),
  NOTIFY_RETENTION_SWEEP_INTERVAL_MS: Number(
    process.env.NOTIFY_RETENTION_SWEEP_INTERVAL_MS ?? 6 * 60 * 60 * 1000,
  ),
};
