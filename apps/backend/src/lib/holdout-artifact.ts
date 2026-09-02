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
    },
  });
  if (!holdoutArtifact || holdoutArtifact.validationRowCount == null) {
    return null;
  }
  return holdoutArtifact;
}
