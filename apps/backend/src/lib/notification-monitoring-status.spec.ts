import { monitoringStatusFromHealth } from './notification-monitoring-status';

/**
 * MODEL-SERVE-022 V03. Pins this server copy to
 * `apps/client/lib/model-status.ts`'s `monitoringStatusFromHealth` case by
 * case (D09) — the two files cannot import each other (separate apps), so
 * this is the only guarantee they cannot silently diverge.
 */
describe('monitoringStatusFromHealth (server pin of the client vocabulary)', () => {
  it('is offline when deploy is undefined, stopped or error, regardless of health', () => {
    expect(monitoringStatusFromHealth('OK', undefined)).toBe('offline');
    expect(monitoringStatusFromHealth('OK', 'stopped')).toBe('offline');
    expect(monitoringStatusFromHealth('ALERT', 'error')).toBe('offline');
  });

  it('maps FROZEN/ALERT/CRITICAL/WARN/OK to their five words when deploy is running', () => {
    expect(monitoringStatusFromHealth('FROZEN', 'running')).toBe('frozen');
    expect(monitoringStatusFromHealth('ALERT', 'running')).toBe('alert');
    expect(monitoringStatusFromHealth('CRITICAL', 'running')).toBe('alert');
    expect(monitoringStatusFromHealth('WARN', 'running')).toBe('warning');
    expect(monitoringStatusFromHealth('OK', 'running')).toBe('normal');
  });

  it('OFF and UNKNOWN never fold into normal — offline, matching the client (no evidence is not health)', () => {
    expect(monitoringStatusFromHealth('OFF', 'running')).toBe('offline');
    expect(monitoringStatusFromHealth('UNKNOWN', 'running')).toBe('offline');
    expect(monitoringStatusFromHealth(undefined, 'running')).toBe('offline');
  });

  it('a list-path OFF (deriveDeployStatuses output) never produces a recovery-worthy status', () => {
    // deriveDeployStatuses reports OFF for "no fault, no claim" — this must
    // never read as 'normal', or an evaluator built on it could fabricate
    // a recovery for a model that was never actually measured healthy.
    expect(monitoringStatusFromHealth('OFF', 'running')).not.toBe('normal');
  });
});
