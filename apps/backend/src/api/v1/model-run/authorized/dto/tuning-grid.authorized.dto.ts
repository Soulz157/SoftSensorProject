import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * MODEL-FLOW-024. The two size figures the tuning-grid endpoint accepts so
 * the client can ask "which variants would a search try for a dataset THIS
 * big" — the same two figures a candidate job carries (`sizedDistinctLabelled`
 * / `sizedRowCount`, both read off the client's own /split-stats response).
 * Both optional and independent: absent means the medium table, the one that
 * shipped before sizing existed. Coerced, since query values arrive as
 * strings.
 */
export const TuningGridQuerySchema = z
  .object({
    distinctLabelled: z.coerce.number().int().nonnegative().optional(),
    rows: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export class TuningGridQueryDto extends createZodDto(TuningGridQuerySchema) {}
