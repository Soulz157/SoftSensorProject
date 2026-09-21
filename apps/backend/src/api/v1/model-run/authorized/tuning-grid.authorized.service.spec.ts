import { AppException } from '@softsensor/common';
import { TuningGridAuthorizedService } from './tuning-grid.authorized.service';
import {
  TUNE_VARIANTS_PER_JOB,
  TUNING_GRID,
  tuningVariantsFor,
} from '@/lib/tuning-grid';

/**
 * MODEL-FLOW-022-T03b. Read-only view over `tuning-grid.ts` — asserts it
 * returns the SAME data `tuningCandidatesFor` reads, verbatim, rather than
 * a second copy of the grid.
 */
describe('TuningGridAuthorizedService', () => {
  const service = new TuningGridAuthorizedService();

  it('returns the exact grid variants and job cap for a known algorithm', () => {
    const result = service.get('ridge');

    expect(result.algorithm).toBe('ridge');
    expect(result.variants).toEqual(TUNING_GRID.ridge);
    expect(result.maxVariantsPerJob).toBe(TUNE_VARIANTS_PER_JOB);
  });

  it('throws an AppException for an algorithm with no grid entry', () => {
    expect(() => service.get('not-a-real-algorithm')).toThrow(AppException);
  });

  it('serves lstm and gru now that they have a grid (MODEL-FLOW-024), by reference like every other algorithm', () => {
    for (const algorithm of ['lstm', 'gru']) {
      const { variants } = service.get(algorithm);
      expect(variants.length).toBeGreaterThan(0);
      expect(variants).toBe(TUNING_GRID[algorithm]);
    }
  });

  it('reports the medium tier and the exact medium table when no size is sent', () => {
    const result = service.get('xgboost');
    expect(result.tier).toBe('medium');
    expect(result.variants).toBe(TUNING_GRID.xgboost);
  });

  it('serves the size tier the figure selects, from the same source the job builder reads', () => {
    const tiny = service.get('xgboost', { distinctLabelled: 32 });
    expect(tiny.tier).toBe('tiny');
    expect(tiny.variants).toBe(
      tuningVariantsFor('xgboost', { distinctLabelled: 32 }),
    );
    expect(tiny.variants).not.toEqual(TUNING_GRID.xgboost);
  });

  it('returns a fresh reference each call rather than sharing TUNING_GRID mutably', () => {
    // Not a strict requirement of the contract, but the response object
    // itself (not `variants`, which IS the same array reference on purpose
    // — "served, not copied") must be a distinct wrapper per call.
    expect(service.get('ols')).not.toBe(service.get('ols'));
  });
});
