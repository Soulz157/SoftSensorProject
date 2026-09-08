import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { TUNE_VARIANTS_PER_JOB, TUNING_GRID } from '@/lib/tuning-grid';

export interface TuningGridResponse {
  algorithm: string;
  variants: Array<Record<string, string | number | boolean | null>>;
  maxVariantsPerJob: number;
}

/**
 * MODEL-FLOW-022-T03b. Read-only view over `tuning-grid.ts` — the SAME data
 * `tuningCandidatesFor` (model-candidate-job.authorized.service.ts) reads to
 * build a Find Best Parameters job's phase-2 candidates. Exists so the
 * client can SHOW which variants a search will try without copying the grid
 * (use-model-training.ts's own no-duplication rule for it). No Prisma, no
 * mutation, no auth beyond the standard JWT guard the controller applies.
 */
@Injectable()
export class TuningGridAuthorizedService {
  get(algorithm: string): TuningGridResponse {
    const variants = TUNING_GRID[algorithm];
    if (!variants) {
      throw new AppException({
        statusCode: 404,
        message: `No tuning grid for "${algorithm}" — it may not support Find Best Parameters.`,
        type: 'ERROR',
      });
    }
    return {
      algorithm,
      variants,
      maxVariantsPerJob: TUNE_VARIANTS_PER_JOB,
    };
  }
}
