import { AppException } from '@softsensor/common';
import { TuningGridAuthorizedService } from './tuning-grid.authorized.service';
import {
  PARAM_GRID,
  PARAM_GRID_OVERRIDES,
  SIZE_TIER_LOWER_BOUNDS,
  TUNE_VARIANTS_PER_JOB,
  TUNING_GRID,
  tuningVariantsFor,
} from '@/lib/tuning-grid';

// Rows in the tiny and medium tiers, derived so a moved bound moves them too.
const TINY_ROWS = SIZE_TIER_LOWER_BOUNDS.small - 1;
const MEDIUM_ROWS = SIZE_TIER_LOWER_BOUNDS.medium;

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

  it('says `sized` only when the served list actually differs from the general one', () => {
    expect(service.get('xgboost').sized).toBe(false);
    expect(service.get('xgboost', { rows: MEDIUM_ROWS }).sized).toBe(false);
    expect(service.get('xgboost', { rows: TINY_ROWS }).sized).toBe(true);
    // The distinct labelled count sizes nothing any more — rows alone do.
    expect(service.get('xgboost', { distinctLabelled: 32 }).sized).toBe(false);
    // A tier alone does not size an algorithm no tier changes...
    expect(service.get('ols', { rows: TINY_ROWS }).sized).toBe(false);
    expect(service.get('lstm', { rows: TINY_ROWS }).sized).toBe(false);
    // ...but the sequence batch cap and the PLS component cap do.
    expect(service.get('lstm', { rows: 400 }).sized).toBe(true);
    expect(service.get('pls', { features: 3 }).sized).toBe(true);
    expect(service.get('pls', { features: 12 }).sized).toBe(false);
  });

  it('serves the size tier the figure selects, from the same source the job builder reads', () => {
    const tiny = service.get('xgboost', { rows: TINY_ROWS });
    expect(tiny.tier).toBe('tiny');
    expect(tiny.variants).toBe(
      tuningVariantsFor('xgboost', { rows: TINY_ROWS }),
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

/** MODEL-FLOW-038. The default GridSearchCV search space, served not copied. */
describe('TuningGridAuthorizedService.getParamGrid', () => {
  const service = new TuningGridAuthorizedService();

  it('returns the default grid with the caps the job endpoint enforces', () => {
    const result = service.getParamGrid('ridge');

    expect(result.paramGrid).toEqual(PARAM_GRID.ridge);
    expect(result.tier).toBe('medium');
    expect(result.maxCombinations).toBe(64);
    expect(result.maxValuesPerKey).toBe(10);
  });

  it('sizes the grid off rows, like the variant list', () => {
    const result = service.getParamGrid('xgboost', { rows: TINY_ROWS });

    expect(result.tier).toBe('tiny');
    expect(result.paramGrid).toEqual(PARAM_GRID_OVERRIDES.tiny?.xgboost);
  });

  it('404s for lstm/gru, which keep the curated variant search', () => {
    expect(() => service.getParamGrid('lstm')).toThrow(AppException);
  });

  describe('what the client needs to price a parallel search', () => {
    const saved = process.env.TRAINING_NANO_CPUS;
    afterEach(() => {
      if (saved === undefined) delete process.env.TRAINING_NANO_CPUS;
      else process.env.TRAINING_NANO_CPUS = saved;
    });

    it('reports the production CPU budget (2) and the forests as parallel', () => {
      delete process.env.TRAINING_NANO_CPUS;
      expect(service.getParamGrid('extra_trees')).toMatchObject({
        cpuBudget: 2,
        parallel: true,
      });
      expect(service.getParamGrid('random_forest').parallel).toBe(true);
    });

    it('reports every other algorithm as serial', () => {
      for (const algorithm of [
        'ridge',
        'ols',
        'pls',
        'svm',
        'mlp',
        'lightgbm',
      ]) {
        expect(service.getParamGrid(algorithm).parallel).toBe(false);
      }
    });

    it('follows the quota the container is really given', () => {
      process.env.TRAINING_NANO_CPUS = String(4 * 1e9);
      expect(service.getParamGrid('extra_trees').cpuBudget).toBe(4);
    });
  });
});
