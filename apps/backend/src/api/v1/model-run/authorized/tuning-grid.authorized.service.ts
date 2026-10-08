import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import {
  TUNE_VARIANTS_PER_JOB,
  TUNING_GRID,
  sizeTierFor,
  tuningVariantsFor,
  type DatasetSize,
  type SizeTier,
} from '@/lib/tuning-grid';

export interface TuningGridResponse {
  algorithm: string;
  variants: Array<Record<string, string | number | boolean | null>>;
  maxVariantsPerJob: number;
  /** MODEL-FLOW-024. The size tier the variants were chosen for; `medium`
   *  when no figure was sent. */
  tier: SizeTier;
  /** MODEL-FLOW-024. True when the variants differ from the general list for
   *  this algorithm — a tier override, a PLS component cap or an LSTM/GRU
   *  batch cap. Read off array identity (`tuningVariantsFor` returns the
   *  general table itself when nothing applies), so it cannot say "sized" for
   *  a list that is not. `tier` alone cannot: an lstm at a `tiny` tier is not
   *  sized by it. */
  sized: boolean;
}

/**
 * MODEL-FLOW-022-T03b. Read-only view over `tuning-grid.ts` — the SAME data
 * `tuningCandidatesFor` (model-candidate-job.authorized.service.ts) reads to
 * build a Find Best Parameters job's phase-2 candidates. Exists so the
 * client can SHOW which variants a search will try without copying the grid
 * (use-model-training.ts's own no-duplication rule for it). No Prisma, no
 * mutation, no auth beyond the standard JWT guard the controller applies.
 *
 * MODEL-FLOW-024. Optionally sized: with a `DatasetSize` it serves the tier's
 * variants from the SAME `tuningVariantsFor` the job builder calls, so what
 * the client previews is what a job would run. Without one it is
 * `TUNING_GRID[algorithm]` exactly as before.
 */
@Injectable()
export class TuningGridAuthorizedService {
  get(algorithm: string, size?: DatasetSize): TuningGridResponse {
    if (!TUNING_GRID[algorithm]) {
      throw new AppException({
        statusCode: 404,
        message: `No tuning grid for "${algorithm}" — it may not support Find Best Parameters.`,
        type: 'ERROR',
      });
    }
    const variants = tuningVariantsFor(algorithm, size);
    return {
      algorithm,
      variants,
      maxVariantsPerJob: TUNE_VARIANTS_PER_JOB,
      tier: sizeTierFor(size?.rows),
      sized: variants !== TUNING_GRID[algorithm],
    };
  }
}
