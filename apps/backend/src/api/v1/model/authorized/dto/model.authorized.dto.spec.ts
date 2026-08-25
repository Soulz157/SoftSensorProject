import {
  ModelConfigSchema,
  DeploymentConfigSchema,
} from './model.authorized.dto';

/**
 * MODEL-FLOW-006. `ModelConfigSchema` went from `.passthrough()` to
 * `.strict()` — this file pins the trap that rewrite had to avoid: a
 * legacy row (real shape, pulled from the live dev DB — the `password`
 * value below is the value already stored there, DB-masked, not a live
 * secret) must still validate byte-for-byte, while a genuinely unknown key
 * is refused. A schema that quietly stripped keys instead of refusing them
 * would pass a naive "still valid" check while silently mutating data the
 * user never touched — these tests check parsed output equals input, not
 * just that parsing succeeds.
 */
describe('ModelConfigSchema', () => {
  it('round-trips a real legacy row byte-for-byte (dead pre-Data-Studio ETL keys)', () => {
    // Pulled from a real Model.data.config row in the dev DB.
    const legacy = {
      timeRange: '1min',
      dataSource: {
        id: 'ds-2',
        host: 'db.plant.local',
        name: 'Pump Station SQL DB',
        type: 'sql',
        dbName: 'pump_station',
        status: 'connected',
        lastUsed: '2026-06-20',
        password: '••••••',
        username: 'readonly',
        createdBy: 'Engineering Team',
      },
      description: 'asd',
      selectedTags: ['FI-404', 'PI-303', 'VI-202', 'TI-101'],
      savedSourceId: 'ds-2',
      fillStrategies: {},
      customDateRange: null,
      selectedMetrics: ['r2', 'rmse', 'sd'],
    };

    const result = ModelConfigSchema.parse(legacy);
    expect(result).toEqual(legacy);
  });

  it('accepts a current buildModelConfig-shaped payload', () => {
    const current = {
      description: 'Boiler efficiency',
      datasetId: 'ds-1',
      algorithm: 'ols',
      algorithms: ['ols', 'ridge'],
      findBestModel: false,
      findBestParams: false,
      targetVariables: ['S204FBP.lab'],
      hyperparameters: { fit_intercept: true },
      lossFunction: 'rmse',
      trainTestSplit: 80,
      selectedMetrics: ['r2', 'rmse', 'sd'],
    };

    const result = ModelConfigSchema.parse(current);
    expect(result).toEqual(current);
  });

  it('accepts the deprecated singular targetVariable alongside targetVariables', () => {
    const result = ModelConfigSchema.parse({
      targetVariable: 'TI-101',
      targetVariables: ['TI-101'],
    });
    expect(result.targetVariable).toBe('TI-101');
  });

  it('refuses a genuinely unknown key', () => {
    expect(() =>
      ModelConfigSchema.parse({ description: 'x', notARealField: 1 }),
    ).toThrow();
  });

  it('refuses a non-scalar hyperparameter value', () => {
    expect(() =>
      ModelConfigSchema.parse({
        hyperparameters: { layers: [64, 32] },
      }),
    ).toThrow();
  });

  it('refuses trainTestSplit as a fraction — the unit is a percentage here', () => {
    expect(() => ModelConfigSchema.parse({ trainTestSplit: 0.8 })).toThrow();
  });

  it('accepts trainTestSplit as the percentage every real row contains', () => {
    expect(ModelConfigSchema.parse({ trainTestSplit: 80 }).trainTestSplit).toBe(
      80,
    );
  });

  it('accepts a full deployment config', () => {
    const deployment = {
      autoRetrain: true,
      warnSd: 1.5,
      criticalSd: 3.0,
      driftMonitor: true,
      driftThresholdPct: 10,
    };
    expect(DeploymentConfigSchema.parse(deployment)).toEqual(deployment);
    expect(ModelConfigSchema.parse({ deployment }).deployment).toEqual(
      deployment,
    );
  });

  it('refuses an unknown key inside deployment', () => {
    expect(() =>
      DeploymentConfigSchema.parse({ autoRetrain: true, notARealField: 1 }),
    ).toThrow();
  });
});
