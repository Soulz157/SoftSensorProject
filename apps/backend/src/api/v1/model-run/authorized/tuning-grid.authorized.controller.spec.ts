import { TuningGridAuthorizedController } from './tuning-grid.authorized.controller';
import { TuningGridAuthorizedService } from './tuning-grid.authorized.service';
import type { ModelRetrainAuthorizedService } from './model-retrain.authorized.service';
import { SIZE_TIER_LOWER_BOUNDS } from '@/lib/tuning-grid';

// Rows either side of the tier edges, derived so a moved bound moves these too.
const TINY_ROWS = SIZE_TIER_LOWER_BOUNDS.small - 1;
const LARGE_ROWS = SIZE_TIER_LOWER_BOUNDS.large;

/**
 * MODEL-FLOW-024. The controller is the only place the two ways of naming a
 * dataset's size meet — explicit figures and `modelId` — so the rule between
 * them is pinned here rather than left to the wiring.
 */
describe('TuningGridAuthorizedController — sizing', () => {
  const USER = { id: 'user-1', role: 'ADMIN' } as Auth.UserPayload;

  function build(
    resolved: {
      distinctLabelled?: number | null;
      rows?: number | null;
      features?: number | null;
    } = {},
  ) {
    const retrain = {
      resolveTuningSizeService: jest.fn().mockResolvedValue(resolved),
    };
    const tuningGrid = new TuningGridAuthorizedService();
    const spy = jest.spyOn(tuningGrid, 'get');
    const controller = new TuningGridAuthorizedController(
      tuningGrid,
      retrain as unknown as ModelRetrainAuthorizedService,
    );
    return { controller, retrain, spy };
  }

  it('is the medium grid, with no model lookup, when nothing is sent', async () => {
    const { controller, retrain } = build();

    const res = await controller.get('xgboost', {}, USER);

    expect(res.tier).toBe('medium');
    expect(retrain.resolveTuningSizeService).not.toHaveBeenCalled();
  });

  it('sizes from explicit figures', async () => {
    const { controller } = build();

    // A large distinct count beside a tiny row count: rows alone pick the tier.
    const res = await controller.get(
      'xgboost',
      { distinctLabelled: 900, rows: TINY_ROWS },
      USER,
    );

    expect(res.tier).toBe('tiny');
  });

  it('resolves the figures from the model when a modelId is sent', async () => {
    const { controller, retrain } = build({
      distinctLabelled: 900,
      rows: TINY_ROWS,
    });

    const res = await controller.get(
      'xgboost',
      { modelId: '11111111-1111-4111-8111-111111111111' },
      USER,
    );

    expect(retrain.resolveTuningSizeService).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'xgboost',
      USER,
    );
    expect(res.tier).toBe('tiny');
  });

  it('lets an explicit figure beat the model’s, field by field', async () => {
    const { controller, spy } = build({
      distinctLabelled: 32,
      rows: TINY_ROWS,
    });

    const res = await controller.get(
      'xgboost',
      {
        modelId: '11111111-1111-4111-8111-111111111111',
        rows: LARGE_ROWS,
      },
      USER,
    );

    // The explicit rows beat the model's and pick the tier; the model's
    // distinct count survives untouched — the merge is per field.
    expect(res.tier).toBe('large');
    expect(spy).toHaveBeenCalledWith('xgboost', {
      distinctLabelled: 32,
      rows: LARGE_ROWS,
      features: undefined,
    });
  });

  it('passes the feature count through, and it caps pls', async () => {
    const { controller } = build();

    const res = await controller.get('pls', { features: 2 }, USER);

    for (const v of res.variants) {
      expect(Number(v.n_components)).toBeLessThanOrEqual(2);
    }
  });
});
