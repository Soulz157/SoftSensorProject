import type { HealthStatus } from './model-health';
import type { DeployStatus } from './deploy-status';

/**
 * MODEL-SERVE-022-D09. A SERVER-SIDE PIN of
 * `apps/client/lib/model-status.ts`'s `monitoringStatusFromHealth` —
 * T01's audit found no server copy of the five-word vocabulary
 * (normal/warning/alert/offline/frozen) the Model Detail badge renders, and
 * D02 requires a notification to use the SAME wording, never a second
 * vocabulary invented for messages. Two apps, so no import is possible
 * across the boundary; this is a PINNED COPY, not a reimplementation from
 * scratch — every branch below must match the client file's branch for
 * branch, and `notification-monitoring-status.spec.ts` checks that pairing
 * case by case.
 *
 * KEEP THIS IN SYNC WITH apps/client/lib/model-status.ts's
 * `monitoringStatusFromHealth`. If that function gains a case, this one
 * must too, or a notification will disagree with the badge on screen —
 * exactly the defect D02 exists to prevent.
 */
export type EffectiveProdStatus =
  | 'normal'
  | 'warning'
  | 'alert'
  | 'offline'
  | 'frozen';

export function monitoringStatusFromHealth(
  health: HealthStatus | undefined,
  deploy: DeployStatus | undefined,
): EffectiveProdStatus {
  if (deploy === undefined || deploy === 'stopped' || deploy === 'error') {
    return 'offline';
  }

  switch (health) {
    case 'FROZEN':
      return 'frozen';
    case 'ALERT':
    case 'CRITICAL':
      return 'alert';
    case 'WARN':
      return 'warning';
    case 'OK':
      return 'normal';
    // OFF, UNKNOWN, and an absent payload all mean "no claim".
    default:
      return 'offline';
  }
}
