import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Contracts for `DatasetDraft` — the draft-first architecture's wizard-time
 * owner (see `feature_list.preprocessing.json`'s `decisions.draft_first`).
 *
 * `CreateRawVersionSchema`, `StartCleanJobSchema` and `ListRowsSchema` from
 * `dataset-version.authorized.dto.ts` are reused as-is for the draft-scoped
 * materialize/clean/rows routes below — the request shape a browser sends to
 * fetch or clean data does not change depending on whether the owner is a
 * Dataset or a DatasetDraft, only the URL and the server-side scoping do.
 */
export const CreateDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  /**
   * Sources the wizard may read for THIS draft. Mirrors `Dataset.sourceIds` —
   * it is the guard that stops a caller naming an arbitrary DataSource id and
   * having the server connect with that source's decrypted credentials, and
   * it exists precisely because no `Dataset` row exists yet to scope against.
   */
  sourceIds: z.array(z.string().uuid()).min(1),
  name: z.string().min(1).optional(),
});

export class CreateDraftDto extends createZodDto(CreateDraftSchema) {}

/**
 * DS-LAKE-009-T02. Deliberately its OWN schema, not `CreateDatasetSchema`
 * reused with an optional `draftId` bolted on — `workspaceId`/`sourceIds`
 * come from the draft itself and `rowCount`/`missingPct` come from the
 * FINAL artifact being adopted, so none of those fields belong on this
 * request at all. Keeping Save as a single-purpose endpoint (rather than a
 * second code path through `createDatasetService`) is what lets
 * DS-LAKE-009-T05 ("assert no code path outside Save creates a
 * DatasetVersion") audit one call site instead of two.
 *
 * DS-LAKE-009-T04: deliberately has NO `expectedTags`/`maxMissingPct`/
 * `maxOutlierFraction` override fields, unlike `ValidateArtifactSchema`/
 * `PromoteFinalArtifactSchema`. At `/finalize` those overrides are how a
 * caller CONFIGURES the promotion gate — a legitimate first use. At Save
 * there is nothing to configure: the artifact was already promoted under
 * whatever thresholds applied then, and Save's re-validation is a
 * re-CHECK, not a second configuration point. Accepting them here would
 * let a caller who bypasses the UI relax the gate in the same request that
 * asks Save to enforce it — exactly what "server-side, not only in the
 * UI" rules out.
 *
 * `tags` (DS-LAKE-005B-B-T01, Step 5 leg): now the SAME class of field as
 * `rowCount`/`missingPct` above — optional, not required, because the
 * server derives it from the FINAL artifact being adopted when the caller
 * omits it (`getDraftArtifactMetadataService`'s own Python `/metadata`
 * call, reused). Kept optional rather than removed so a caller that still
 * sends an explicit list (legacy UI path, or a future non-UI caller with a
 * real reason to override) is not rejected outright.
 */
export const SaveDraftAsDatasetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pipelineConfig: z.record(z.string(), z.unknown()).default({}),
  fileUrl: z.string().nullish(),
});

export class SaveDraftAsDatasetDto extends createZodDto(
  SaveDraftAsDatasetSchema,
) {}
