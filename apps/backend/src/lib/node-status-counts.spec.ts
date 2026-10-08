import { deriveNodeSummary } from './node-summary';
import { summaryFromCounts } from './node-status-counts';

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
  PrismaTypes: { sql: jest.fn(), join: jest.fn() },
}));

/** What the SQL counts for one node — the same rule the query applies:
 *  `data->>'status'` equal to exactly alarm / warning / offline. */
function sqlCount(nodes: { data: unknown }[]) {
  const st = (d: unknown) => {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const v = (d as Record<string, unknown>).status;
    // `->>` turns any JSON value into text; only these strings match.
    return typeof v === 'string'
      ? v
      : v === undefined || v === null
        ? null
        : JSON.stringify(v);
  };
  return {
    nodeCount: nodes.length,
    alarmCount: nodes.filter((n) => st(n.data) === 'alarm').length,
    warningCount: nodes.filter((n) => st(n.data) === 'warning').length,
    offlineCount: nodes.filter((n) => st(n.data) === 'offline').length,
  };
}

const n = (data: unknown) => ({ data });

describe('summaryFromCounts — same answer as deriveNodeSummary', () => {
  const cases: [string, { data: unknown }[]][] = [
    ['no nodes', []],
    ['all normal', [n({ status: 'normal' }), n({})]],
    ['warning only', [n({ status: 'warning' }), n({ status: 'normal' })]],
    [
      'offline beats warning',
      [n({ status: 'warning' }), n({ status: 'offline' })],
    ],
    [
      'alarm beats everything',
      [
        n({ status: 'offline' }),
        n({ status: 'alarm' }),
        n({ status: 'warning' }),
      ],
    ],
    [
      'unknown status reads normal',
      [n({ status: 'ALARM' }), n({ status: 'fault' })],
    ],
    ['non-object data reads normal', [n(null), n('alarm'), n(['alarm']), n(3)]],
    ['non-string status reads normal', [n({ status: 1 }), n({ status: true })]],
  ];

  it.each(cases)('%s', (_name, nodes) => {
    expect(summaryFromCounts(sqlCount(nodes))).toEqual(
      deriveNodeSummary(nodes),
    );
  });

  it('defaults to the empty roll-up for a workspace with no nodes', () => {
    expect(summaryFromCounts()).toEqual(deriveNodeSummary([]));
  });
});
