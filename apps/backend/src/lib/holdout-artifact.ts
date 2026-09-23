import { PrismaService } from '@softsensor/prisma';

/**
 * Extracted from `tryReplayHoldout` (model-run.authorized.service.ts) —
 * MODEL-FLOW-016-T07's scoring-trigger needs the SAME existence check
 * (cheap: does this run's dataset have a holdout at all) before spawning a
 * container, while `tryReplayHoldout` still does the expensive replay/
 * prepare + presign using this same resolved row. One lookup, two callers.
 *
 * TWO holdout shapes can exist on the same `runId` chain, and they are
 * mutually exclusive per D1 (feature_list.preprocessing.json): a legacy RAW
 * holdout, cut at BRONZE before features ever ran (needs a full recipe
 * REPLAY), or a DS-LAKE-023 FEATURE-BEARING holdout, cut after features ran
 * (needs only the recorded scaler PREPARED, no replay). `pipelineVersion`
 * cannot discriminate these — DS-LAKE-022 already stamps every create-mode
 * SILVER with it regardless of whether a holdout was ever picked. The only
 * reliable signal is WHICH ARTIFACT ROW actually carries a non-null
 * `validationRowCount`.
 */
export async function findHoldoutArtifact(
  prisma: PrismaService,
  goldArtifactId: string,
) {
  const gold = await prisma.datasetArtifact.findUnique({
    where: { id: goldArtifactId },
    select: { runId: true },
  });
  if (!gold) return null;

  // Deterministically ordered (finding: DS-LAKE-023's own audit found the
  // legacy resolver used an unordered `findFirst` — a draft resplit more
  // than once can leave two artifacts sharing one `runId`, and picking the
  // wrong one silently replays/prepares the WRONG holdout, or none). Newest
  // first: a later split always supersedes an earlier one for scoring
  // purposes, matching resplit's own "always write a NEW artifact" contract.
  //
  // `GOLD` joins `BRONZE`/`SILVER` here as of DS-LAKE-023's edit-mode
  // re-split pass: edit mode's FEATURE job writes a combined, already-scaled
  // GOLD (`preprocessing-job.service.ts`'s own `artifactType` decision — a
  // FEATURE job commits SILVER only when `scale === false`, which edit mode
  // never sends), so an edit-mode holdout's `validationRowCount` lands on a
  // GOLD row, not a SILVER one. Without this, an edit-mode holdout would be
  // invisible to this resolver.
  const holdoutArtifact = await prisma.datasetArtifact.findFirst({
    where: {
      runId: gold.runId,
      type: { in: ['BRONZE', 'SILVER', 'GOLD'] },
      validationRowCount: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      type: true,
      objectKey: true,
      validationRowCount: true,
      validationHoldoutFrom: true,
      // MODEL-SERVE-015-T04. False for every holdout shape above — even a
      // GOLD row's, whose validate_data.parquet is captured BEFORE the
      // scale step inside `features()` (see that function's own ordering),
      // so it is feature-bearing but still unscaled like every other shape
      // here. True only for a retrain-augmentation combined GOLD, whose
      // frozen-eval slice is cut straight out of an ALREADY-scaled FINAL —
      // see this column's own schema comment for why re-scaling it would
      // be wrong.
      validationAlreadyScaled: true,
      // Carries the new-data validation window's own facts when an
      // augmented retrain carved one out (`newValidationRowCount` and
      // friends, written by `buildCombinedArtifact`). Selected here so the
      // claim path can tell "a second holdout sidecar exists" from "none
      // was requested" without probing object storage — there is no
      // existence-check helper on this side, and a recorded fact is a
      // better source of truth than a store round trip anyway.
      operations: true,
    },
  });
  if (!holdoutArtifact || holdoutArtifact.validationRowCount == null) {
    return null;
  }
  return holdoutArtifact;
}

/**
 * Whether this artifact's `operations` record an operator-defined new-data
 * validation window — i.e. whether a `validate_new_data.parquet` sidecar
 * was actually written beside it.
 *
 * Reads the recorded row count rather than any "requested" flag, and treats
 * a count of 0 as no window: python refuses to commit an empty window, so a
 * recorded 0 could only come from a malformed blob, and attempting to
 * passthrough a sidecar that does not exist would fail the claim's nested
 * handler for nothing.
 *
 * Deliberately tolerant of shape: `operations` is untyped JSON written by
 * several different producers, so anything unexpected reads as "no window"
 * rather than throwing inside the claim path.
 */
export function readNewDataValidationWindow(operations: unknown): {
  rowCount: number;
  from: Date | null;
  to: Date | null;
} | null {
  if (!Array.isArray(operations)) return null;
  for (const entry of operations) {
    if (!entry || typeof entry !== 'object') continue;
    const op = entry as Record<string, unknown>;
    const rowCount = op.newValidationRowCount;
    if (typeof rowCount !== 'number' || rowCount <= 0) continue;
    // The boundaries are informational; a malformed or missing one must not
    // cost the caller the window itself, so they degrade to null
    // independently of the row count that proves the sidecar exists.
    const parse = (v: unknown): Date | null => {
      if (typeof v !== 'string') return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    return {
      rowCount,
      from: parse(op.newValidationFrom),
      to: parse(op.newValidationTo),
    };
  }
  return null;
}

/** Convenience predicate over {@link readNewDataValidationWindow}. */
export function hasNewDataValidationWindow(operations: unknown): boolean {
  return readNewDataValidationWindow(operations) !== null;
}
