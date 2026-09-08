import { AppException } from '@softsensor/common';
import { TuningGridAuthorizedService } from './tuning-grid.authorized.service';
import { TUNE_VARIANTS_PER_JOB, TUNING_GRID } from '@/lib/tuning-grid';

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
    expect(() => service.get('lstm')).toThrow(AppException);
  });

  it('returns a fresh reference each call rather than sharing TUNING_GRID mutably', () => {
    // Not a strict requirement of the contract, but the response object
    // itself (not `variants`, which IS the same array reference on purpose
    // — "served, not copied") must be a distinct wrapper per call.
    expect(service.get('ols')).not.toBe(service.get('ols'));
  });
});
