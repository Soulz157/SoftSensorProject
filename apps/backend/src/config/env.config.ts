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
};
