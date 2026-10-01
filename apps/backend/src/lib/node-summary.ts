/**
 * A workspace's or plant's equipment roll-up, from its canvas nodes.
 *
 * `status` is the WORST of the four node states (alarm > offline > warning >
 * normal), unchanged. It is what the 4-state views colour by. Whether that
 * reads Normal or Abnormal is decided where it is shown, by one rule
 * (MODEL-SERVE-024-D02): only `alarm` — and, client-side, a failed deploy or a
 * monitoring alert on a model placed there — is Abnormal.
 *
 * MODEL-SERVE-024-D05. `alarmCount` counts ALARM nodes only, so it agrees with
 * Abnormal; it used to count every non-normal node. `warningCount` and
 * `offlineCount` carry the rest, so the bell total and the plant page lose
 * nothing.
 *
 * Shared by the workspace and workspace-plant services, which each kept an
 * identical private copy before.
 */
export type NodeRollupStatus = 'normal' | 'warning' | 'alarm' | 'offline';

export interface NodeSummary {
  nodeCount: number;
  alarmCount: number;
  warningCount: number;
  offlineCount: number;
  status: NodeRollupStatus;
}

const PRIORITY: Record<NodeRollupStatus, number> = {
  normal: 0,
  warning: 1,
  offline: 2,
  alarm: 3,
};

function nodeStatus(data: unknown): NodeRollupStatus {
  const st =
    data && typeof data === 'object'
      ? (data as Record<string, unknown>).status
      : undefined;
  return st === 'alarm' || st === 'warning' || st === 'offline' ? st : 'normal';
}

export function deriveNodeSummary(nodes: { data: unknown }[]): NodeSummary {
  let status: NodeRollupStatus = 'normal';
  let alarmCount = 0;
  let warningCount = 0;
  let offlineCount = 0;
  for (const node of nodes) {
    const st = nodeStatus(node.data);
    if (st === 'alarm') alarmCount++;
    else if (st === 'warning') warningCount++;
    else if (st === 'offline') offlineCount++;
    if (PRIORITY[st] > PRIORITY[status]) status = st;
  }
  return {
    nodeCount: nodes.length,
    alarmCount,
    warningCount,
    offlineCount,
    status,
  };
}
