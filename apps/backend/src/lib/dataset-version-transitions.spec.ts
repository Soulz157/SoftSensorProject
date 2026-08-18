import {
  isLegalTransition,
  type DatasetLifecycleStatus,
} from './dataset-version-transitions';

const ALL_STATUSES: DatasetLifecycleStatus[] = [
  'DRAFT',
  'VALIDATED',
  'ACTIVE',
  'DEPRECATED',
  'ARCHIVED',
];

describe('isLegalTransition (DS-LAKE-010-T01/T02)', () => {
  it.each([
    ['DRAFT', 'VALIDATED'],
    ['VALIDATED', 'ACTIVE'],
    ['ACTIVE', 'DEPRECATED'],
    ['DEPRECATED', 'ARCHIVED'],
  ] as const)('allows the forward edge %s -> %s', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
  });

  it('refuses the exact backward pair DS-LAKE-010-V02 probes', () => {
    expect(isLegalTransition('ARCHIVED', 'ACTIVE')).toBe(false);
  });

  it('refuses every skip (DRAFT straight to ACTIVE, DEPRECATED, or ARCHIVED)', () => {
    expect(isLegalTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(isLegalTransition('DRAFT', 'DEPRECATED')).toBe(false);
    expect(isLegalTransition('DRAFT', 'ARCHIVED')).toBe(false);
  });

  it("refuses every same-state pair — idempotency is a service-layer policy, not this predicate's job", () => {
    for (const status of ALL_STATUSES) {
      expect(isLegalTransition(status, status)).toBe(false);
    }
  });

  it('refuses every backward pair, exhaustively', () => {
    const forwardOrder: DatasetLifecycleStatus[] = [
      'DRAFT',
      'VALIDATED',
      'ACTIVE',
      'DEPRECATED',
      'ARCHIVED',
    ];
    for (let i = 0; i < forwardOrder.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(isLegalTransition(forwardOrder[i], forwardOrder[j])).toBe(false);
      }
    }
  });

  it('ARCHIVED has no legal outbound transition at all — it is a terminal state', () => {
    for (const status of ALL_STATUSES) {
      expect(isLegalTransition('ARCHIVED', status)).toBe(false);
    }
  });
});
