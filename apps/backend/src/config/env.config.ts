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
  //     transition. Marking ABANDONED itself stays an explicit user action
  //     (abandonDraftService) — this file does not add a second,
  //     inactivity-based auto-abandon path; that is out of this feature's
  //     acceptance criteria and would need its own decision if ever added.
  //   - CLEANUP_INTERMEDIATE_RETENTION_HOURS: how long a SAVED draft's
  //     leftover BRONZE/SILVER/GOLD siblings (everything except the adopted
  //     FINAL) stay available for audit/retry after Save, measured from
  //     DatasetArtifact.createdAt. Per decisions.reproducibility_anchor, a
  //     BRONZE reachable through a non-ARCHIVED DatasetVersion's
  //     parentArtifactId chain is pinned regardless of this value — the
  //     window only ever releases SILVER/GOLD, or a BRONZE that is not (or
  //     no longer) reachable that way.
  // Both default to 7 days.
  CLEANUP_DRAFT_RECOVERY_HOURS: Number(
    process.env.CLEANUP_DRAFT_RECOVERY_HOURS ?? 168,
  ),
  CLEANUP_INTERMEDIATE_RETENTION_HOURS: Number(
    process.env.CLEANUP_INTERMEDIATE_RETENTION_HOURS ?? 168,
  ),
};
