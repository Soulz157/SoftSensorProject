import {
  isPromotable,
  type ModelVersionStage,
} from './model-version-transitions';

const ALL_STAGES: ModelVersionStage[] = ['STAGING', 'PRODUCTION', 'ARCHIVED'];

describe('isPromotable (MODEL-SERVE-001-T02/T04)', () => {
  it.each(['STAGING', 'ARCHIVED'] as const)(
    '%s is promotable — a normal promote and a rollback source',
    (stage) => {
      expect(isPromotable(stage)).toBe(true);
    },
  );

  it("PRODUCTION is not promotable — promoting an already-live version is the service's idempotency case, not this predicate returning true", () => {
    expect(isPromotable('PRODUCTION')).toBe(false);
  });

  it('exhaustively covers every stage in the enum', () => {
    for (const stage of ALL_STAGES) {
      expect(typeof isPromotable(stage)).toBe('boolean');
    }
  });
});
