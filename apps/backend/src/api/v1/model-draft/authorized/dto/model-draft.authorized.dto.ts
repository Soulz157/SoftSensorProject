import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Contracts for `ModelDraft` — the Model Creation wizard's server-side
 * owner while no `Model` row exists yet (MODEL-FLOW-002, see
 * decisions.draft_persistence). Mirrors `dataset-draft.authorized.dto.ts`
 * where the concepts match.
 */
export const CreateModelDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).optional(),
  plantId: z.string().optional(),
  nodeId: z.string().optional(),
  datasetId: z.string().uuid().optional(),
});

export class CreateModelDraftDto extends createZodDto(CreateModelDraftSchema) {}

/**
 * All-optional — Step 2 PATCHes whichever fields changed, not the whole
 * config. This is a deliberate divergence from DatasetDraft, which has no
 * PATCH at all (see decisions.draft_persistence): a training container has
 * no browser and reads its spec from this row, so the row must be kept
 * current as the wizard's own config changes, not shipped once at the end.
 *
 * splitRatio is a FRACTION (0.5-0.95), never a percentage — the API refuses
 * anything outside that range so a percentage that leaked through the
 * client boundary (e.g. 80 instead of 0.8) fails loudly here rather than
 * slicing chronological_split at 80x the intended length.
 */
export const PatchModelDraftSchema = z.object({
  name: z.string().min(1).optional(),
  plantId: z.string().nullable().optional(),
  nodeId: z.string().nullable().optional(),
  datasetId: z.string().uuid().nullable().optional(),
  targetY: z.string().nullable().optional(),
  algorithm: z.string().nullable().optional(),
  hyperparameters: z.record(z.string(), z.unknown()).optional(),
  splitRatio: z.number().min(0.5).max(0.95).nullable().optional(),
});

export class PatchModelDraftDto extends createZodDto(PatchModelDraftSchema) {}

/**
 * Query for the draft list (MODEL-FLOW-010-T08) — how the wizard is reached
 * again after leaving it to edit a dataset.
 *
 * `status` is deliberately the full enum rather than a hard-coded ACTIVE: a
 * TRAINED draft is just as resumable (PATCH only refuses once SAVED), so the
 * API stays general and the caller decides which it wants. The models list
 * asks for ACTIVE only — see MODEL-FLOW-010's acceptance criterion 10.
 */
export const ListModelDraftQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'TRAINED', 'SAVED', 'ABANDONED']).optional(),
});

export class ListModelDraftQueryDto extends createZodDto(
  ListModelDraftQuerySchema,
) {}
