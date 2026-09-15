import { classifyModelHealth, thresholdsFromSchedule } from './model-health';

describe('classifyModelHealth (MODEL-SERVE-001-T21)', () => {
  it('is OFF whenever driftMonitor is false, regardless of the underlying drift status', () => {
    expect(classifyModelHealth(false, 'OK')).toBe('OFF');
    expect(classifyModelHealth(false, 'CRITICAL')).toBe('OFF');
    expect(classifyModelHealth(false, null)).toBe('OFF');
  });

  it('is UNKNOWN when monitoring is on but there is nothing to classify yet', () => {
    // No PRODUCTION version, or no windows with usable stats — the caller
    // never has to distinguish those reasons from each other here.
    expect(classifyModelHealth(true, null)).toBe('UNKNOWN');
  });

  it('passes the drift report status straight through once monitoring is on', () => {
    expect(classifyModelHealth(true, 'OK')).toBe('OK');
    expect(classifyModelHealth(true, 'WARN')).toBe('WARN');
    expect(classifyModelHealth(true, 'CRITICAL')).toBe('CRITICAL');
    expect(classifyModelHealth(true, 'UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('thresholdsFromSchedule (MODEL-SERVE-001-T21)', () => {
  it('renames driftThresholdPct to outOfRangePct, changing nothing else', () => {
    expect(
      thresholdsFromSchedule({
        warnSd: 1.5,
        criticalSd: 3.0,
        driftThresholdPct: 10,
      }),
    ).toEqual({
      warnSd: 1.5,
      criticalSd: 3.0,
      outOfRangePct: 10,
    });
  });

  it('carries a per-schedule override through untouched, not the system default', () => {
    expect(
      thresholdsFromSchedule({
        warnSd: 2.0,
        criticalSd: 4.0,
        driftThresholdPct: 25,
      }),
    ).toEqual({
      warnSd: 2.0,
      criticalSd: 4.0,
      outOfRangePct: 25,
    });
  });
});
