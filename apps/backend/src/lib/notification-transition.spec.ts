import {
  evaluateMonitoringTransition,
  type MonitoringSnapshot,
} from './notification-transition';

const ok: MonitoringSnapshot = {
  status: 'OK',
  reason: null,
  frozenColumns: [],
};
const alertStale: MonitoringSnapshot = {
  status: 'ALERT',
  reason: 'STALE',
  frozenColumns: [],
};
const alertSource: MonitoringSnapshot = {
  status: 'ALERT',
  reason: 'SOURCE_UNREACHABLE',
  frozenColumns: [],
};
const warn: MonitoringSnapshot = {
  status: 'WARN',
  reason: 'DRIFT_WARN',
  frozenColumns: [],
};
const unknown: MonitoringSnapshot = {
  status: 'UNKNOWN',
  reason: null,
  frozenColumns: [],
};
const off: MonitoringSnapshot = {
  status: 'OFF',
  reason: null,
  frozenColumns: [],
};
const frozenA: MonitoringSnapshot = {
  status: 'FROZEN',
  reason: 'SENSOR_FROZEN',
  frozenColumns: ['TI101'],
};
const frozenAB: MonitoringSnapshot = {
  status: 'FROZEN',
  reason: 'SENSOR_FROZEN',
  frozenColumns: ['TI101', 'TI205'],
};

describe('evaluateMonitoringTransition (MODEL-SERVE-022-D01/D03, V01)', () => {
  it('records a baseline and sends nothing on the first evaluation, even into ALERT', () => {
    expect(evaluateMonitoringTransition(null, alertStale)).toEqual({
      changed: true,
      notify: null,
    });
  });

  it('records a baseline and sends nothing on the first evaluation into OK', () => {
    expect(evaluateMonitoringTransition(null, ok)).toEqual({
      changed: true,
      notify: null,
    });
  });

  it('sends exactly one delivery for an unchanged state across N sweeps: notify on the transition INTO alert, nothing on repeats', () => {
    // sweep 0: baseline established from OK (a prior real state), no send.
    let prev = evaluateMonitoringTransition(null, ok).changed ? ok : null;
    // sweep 1: OK -> ALERT, one notify.
    const first = evaluateMonitoringTransition(prev, alertStale);
    expect(first.notify).toEqual({
      event: 'MONITORING_ALERT',
      severity: 'CRITICAL',
    });
    prev = alertStale;
    // sweeps 2..N: unchanged ALERT/STALE, no further notify.
    for (let i = 0; i < 5; i++) {
      const result = evaluateMonitoringTransition(prev, alertStale);
      expect(result).toEqual({ changed: false, notify: null });
    }
  });

  it('a reason change under the same status enqueues a second notification', () => {
    const result = evaluateMonitoringTransition(alertStale, alertSource);
    expect(result.notify).toEqual({
      event: 'MONITORING_ALERT',
      severity: 'CRITICAL',
    });
  });

  it('UNKNOWN -> OK enqueues nothing', () => {
    expect(evaluateMonitoringTransition(unknown, ok)).toEqual({
      changed: true,
      notify: null,
    });
  });

  it('OFF -> OK enqueues nothing', () => {
    expect(evaluateMonitoringTransition(off, ok)).toEqual({
      changed: true,
      notify: null,
    });
  });

  it('WARN -> OK sends MONITORING_RECOVERED', () => {
    expect(evaluateMonitoringTransition(warn, ok).notify).toEqual({
      event: 'MONITORING_RECOVERED',
      severity: 'INFO',
    });
  });

  it('ALERT -> OK sends MONITORING_RECOVERED', () => {
    expect(evaluateMonitoringTransition(alertStale, ok).notify).toEqual({
      event: 'MONITORING_RECOVERED',
      severity: 'INFO',
    });
  });

  it('FROZEN -> OK sends MONITORING_RECOVERED', () => {
    expect(evaluateMonitoringTransition(frozenA, ok).notify).toEqual({
      event: 'MONITORING_RECOVERED',
      severity: 'INFO',
    });
  });

  it('a frozen column that stays frozen (identical set) enqueues nothing', () => {
    expect(evaluateMonitoringTransition(frozenA, frozenA)).toEqual({
      changed: false,
      notify: null,
    });
  });

  it('a newly frozen column enqueues one SENSOR_FROZEN', () => {
    const result = evaluateMonitoringTransition(frozenA, frozenAB);
    expect(result.notify).toEqual({
      event: 'SENSOR_FROZEN',
      severity: 'WARNING',
    });
    expect(result.changed).toBe(true);
  });

  it('entering WARN from OK sends MONITORING_WARNING', () => {
    expect(evaluateMonitoringTransition(ok, warn).notify).toEqual({
      event: 'MONITORING_WARNING',
      severity: 'WARNING',
    });
  });

  it('entering FROZEN from WARN sends SENSOR_FROZEN', () => {
    expect(evaluateMonitoringTransition(warn, frozenA).notify).toEqual({
      event: 'SENSOR_FROZEN',
      severity: 'WARNING',
    });
  });

  it('entering OFF or UNKNOWN from anything sends nothing', () => {
    expect(evaluateMonitoringTransition(alertStale, off).notify).toBeNull();
    expect(evaluateMonitoringTransition(warn, unknown).notify).toBeNull();
  });
});
