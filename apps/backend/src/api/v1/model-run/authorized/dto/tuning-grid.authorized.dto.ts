import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-FLOW-024. What the tuning-grid endpoint accepts so a caller can ask
 * "which variants would a search try for a dataset THIS big".
 *
 * `distinctLabelled` and `rows` are the two figures a candidate job carries
 * (`sizedDistinctLabelled` / `sizedRowCount`, both read off the client's own
 * /split-stats response); `features` is the artifact's feature count, which
 * only `pls` reads. All independent and optional: absent means the medium
 * table, the one that shipped before sizing existed. Only `rows` picks the
 * tier — `distinctLabelled` alone sizes nothing and is accepted for the
 * record.
 *
 * `modelId` is the other way in, for a caller that has no split stats — the
 * model-detail retrain form. The server resolves the same figures a retrain
 * of that Model would inherit, and any figure sent explicitly beside it wins.
 * Coerced, since query values arrive as strings.
 */
export const TuningGridQuerySchema = z
  .object({
    distinctLabelled: z.coerce.number().int().nonnegative().optional(),
    rows: z.coerce.number().int().nonnegative().optional(),
    features: z.coerce.number().int().positive().optional(),
    modelId: z.string().uuid().optional(),
  })
  .strict();

export class TuningGridQueryDto extends createZodDto(TuningGridQuerySchema) {}
