import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import type { NodeSummary } from './node-summary';

/**
 * The same equipment roll-up as `deriveNodeSummary`, computed IN THE
 * DATABASE: one grouped COUNT per workspace instead of loading every node's
 * JSON into the process. Used where many workspaces are summarised at once
 * (the admin summary covers the whole platform).
 *
 * The SQL mirrors `nodeStatus`: only a `data` OBJECT whose `status` is exactly
 * "alarm", "warning" or "offline" counts as that state; anything else —
 * missing, another value, a non-object `data` (`->>` yields NULL) — is normal.
 * `node-status-counts.spec.ts` pins the counts → summary half against
 * `deriveNodeSummary`.
 */
export interface NodeStatusCounts {
  nodeCount: number;
  alarmCount: number;
  warningCount: number;
  offlineCount: number;
}

interface CountRow extends NodeStatusCounts {
  workspaceId: string;
}

const ZERO: NodeStatusCounts = {
  nodeCount: 0,
  alarmCount: 0,
  warningCount: 0,
  offlineCount: 0,
};

/** Worst state wins, same priority as `deriveNodeSummary`:
 *  alarm > offline > warning > normal. */
export function summaryFromCounts(c: NodeStatusCounts = ZERO): NodeSummary {
  const status = c.alarmCount
    ? 'alarm'
    : c.offlineCount
      ? 'offline'
      : c.warningCount
        ? 'warning'
        : 'normal';
  return {
    nodeCount: c.nodeCount,
    alarmCount: c.alarmCount,
    warningCount: c.warningCount,
    offlineCount: c.offlineCount,
    status,
  };
}

/**
 * Node roll-ups keyed by workspace id. With `workspaceIds`, only those
 * workspaces (an empty list makes no query); without, every workspace that is
 * not soft-deleted. A workspace with no nodes is absent from the map — read it
 * with `summaryFromCounts(map.get(id))`, which gives the empty roll-up.
 */
export async function nodeSummariesByWorkspace(
  prisma: PrismaService,
  workspaceIds?: readonly string[],
): Promise<Map<string, NodeSummary>> {
  if (workspaceIds && workspaceIds.length === 0) return new Map();

  const where = workspaceIds
    ? PrismaTypes.sql`WHERE n."workspaceId" IN (${PrismaTypes.join([...workspaceIds])})`
    : PrismaTypes.sql`JOIN "Workspace" w ON w.id = n."workspaceId" AND w."deletedAt" IS NULL`;

  const rows = await prisma.$queryRaw<CountRow[]>(PrismaTypes.sql`
    SELECT n."workspaceId" AS "workspaceId",
      COUNT(*)::int AS "nodeCount",
      COUNT(*) FILTER (WHERE n.data->>'status' = 'alarm')::int AS "alarmCount",
      COUNT(*) FILTER (WHERE n.data->>'status' = 'warning')::int AS "warningCount",
      COUNT(*) FILTER (WHERE n.data->>'status' = 'offline')::int AS "offlineCount"
    FROM "Nodes" n
    ${where}
    GROUP BY n."workspaceId"
  `);

  return new Map(
    rows.map(({ workspaceId, ...c }) => [workspaceId, summaryFromCounts(c)]),
  );
}
