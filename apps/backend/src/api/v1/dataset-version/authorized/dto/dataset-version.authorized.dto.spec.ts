import { CleaningOperationSchema } from './dataset-version.authorized.dto';

/**
 * DS-LAKE-032-V04. `CleaningOperationSchema` is a plain `z.object`, which
 * STRIPS undeclared keys. The time window must survive parsing, or python
 * would clean the whole series while the browser previewed only the window.
 */
describe('CleaningOperationSchema (DS-LAKE-032)', () => {
  it('keeps startTime / endTime on a windowed operation', () => {
    const parsed = CleaningOperationSchema.parse({
      type: 'clip',
      tags: ['TI-101'],
      paramLow: 0,
      param: 10,
      startTime: '2026-01-01 06:00:00',
      endTime: '2026-01-03 17:30:59.999999',
    });
    expect(parsed.startTime).toBe('2026-01-01 06:00:00');
    expect(parsed.endTime).toBe('2026-01-03 17:30:59.999999');
  });

  it('still accepts an operation without a window', () => {
    const parsed = CleaningOperationSchema.parse({ type: 'drop' });
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.endTime).toBeUndefined();
  });
});
