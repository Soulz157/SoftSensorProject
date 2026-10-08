import { deriveNodeSummary } from './node-summary';

/** MODEL-SERVE-024-D05 — the workspace/plant equipment roll-up. */
describe('deriveNodeSummary', () => {
  const node = (status?: unknown) => ({ data: { status } });

  it('counts alarm nodes only in alarmCount, the rest in their own fields', () => {
    const s = deriveNodeSummary([
      node('alarm'),
      node('warning'),
      node('warning'),
      node('offline'),
      node('normal'),
    ]);
    expect(s).toEqual({
      nodeCount: 5,
      alarmCount: 1,
      warningCount: 2,
      offlineCount: 1,
      status: 'alarm',
    });
  });

  it('keeps the worst-of-four status: offline outranks warning', () => {
    expect(deriveNodeSummary([node('warning'), node('offline')]).status).toBe(
      'offline',
    );
  });

  it('reads a missing or unknown status as normal', () => {
    const s = deriveNodeSummary([node(), node('bogus'), { data: null }]);
    expect(s.status).toBe('normal');
    expect(s.alarmCount + s.warningCount + s.offlineCount).toBe(0);
  });
});
