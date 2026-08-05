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
