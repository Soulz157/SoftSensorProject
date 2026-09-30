import {
  buildNotificationMessage,
  monitoringTransitionDetail,
  renderEmail,
  renderTeamsCard,
} from './notification-message';

const PRESIGNED =
  'https://minio.local/bucket/key?X-Amz-Signature=abcd1234&X-Amz-Credential=secret';

describe('buildNotificationMessage timestamp formatting', () => {
  it('renders "Date Mon Year HH:mm UTC", not the raw ISO string', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'Reactor Temp',
      workspaceName: 'Plant A',
      axis: 'MONITORING',
      title: 'test',
      detail: 'normal -> alert',
      severity: 'CRITICAL',
      at: new Date('2026-09-29T06:23:21.724Z'),
    });
    expect(msg.bodyText).toContain('Timestamp: 29 Sep 2026 06:23 UTC');
    expect(msg.bodyText).not.toContain('2026-09-29T06:23:21');
  });

  it('labels every line and keeps the model link last', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'TS',
      workspaceName: 'ROC',
      axis: 'DEPLOY',
      title: 'TS: preflight failed',
      detail: 'running -> error (preflight failed)',
      rawDetailSuffix: 'Tag TI-101 not found',
      severity: 'CRITICAL',
      at: new Date('2026-01-20T17:20:00.000Z'),
    });
    expect(msg.bodyText.split('\n')).toEqual([
      'Workspace: ROC',
      'Model: TS',
      'Detail: running -> error (preflight failed)',
      'Reason: Tag TI-101 not found',
      'Timestamp: 20 Jan 2026 17:20 UTC',
      msg.modelUrl,
    ]);
  });

  it('zero-pads a single-digit hour/minute', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'M',
      workspaceName: 'W',
      axis: null,
      title: 't',
      detail: 'd',
      severity: 'INFO',
      at: new Date('2026-01-05T03:04:09.000Z'),
    });
    expect(msg.bodyText).toContain('5 Jan 2026 03:04 UTC');
  });
});

describe('buildNotificationMessage redaction (MODEL-SERVE-022 V02)', () => {
  it('redacts a presigned URL carried in rawDetailSuffix', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'Reactor Temp',
      workspaceName: 'Plant A',
      axis: 'DEPLOY',
      title: 'test',
      detail: 'running -> error (preflight failed)',
      rawDetailSuffix: `Materialize failed: could not read the source at ${PRESIGNED}`,
      severity: 'CRITICAL',
      at: new Date('2026-09-29T03:00:00.000Z'),
    });
    expect(msg.bodyText).not.toContain('X-Amz-Signature');
    expect(msg.bodyText).not.toContain(PRESIGNED);
    expect(msg.bodyText).toContain('[redacted url]');
  });

  it('the stored payload built from the message is ALSO redacted — the delivery row is itself a sink', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'Reactor Temp',
      workspaceName: 'Plant A',
      axis: 'DEPLOY',
      title: 'test',
      detail: 'running -> error',
      rawDetailSuffix: PRESIGNED,
      severity: 'CRITICAL',
      at: new Date(),
    });
    // Simulate exactly what NotificationOutboxService persists.
    const storedPayload = JSON.parse(
      JSON.stringify({
        title: msg.title,
        bodyText: msg.bodyText,
        modelUrl: msg.modelUrl,
      }),
    ) as { bodyText: string };
    expect(storedPayload.bodyText).not.toContain('X-Amz-Signature');
  });

  it('redacts a presigned URL in both the Teams card and the e-mail body', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'Reactor Temp',
      workspaceName: 'Plant A',
      axis: 'DEPLOY',
      title: 'test',
      detail: 'running -> error',
      rawDetailSuffix: PRESIGNED,
      severity: 'CRITICAL',
      at: new Date(),
    });
    const card = JSON.stringify(renderTeamsCard(msg));
    expect(card).not.toContain('X-Amz-Signature');

    const email = renderEmail(msg);
    expect(email.html).not.toContain('X-Amz-Signature');
    expect(email.text).not.toContain('X-Amz-Signature');
  });

  it('builds a working modelUrl from CLIENT_APP_URL, and falls back to the app root when modelId is null (test-send)', () => {
    const withModel = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'M',
      workspaceName: 'W',
      axis: null,
      title: 't',
      detail: 'd',
      severity: 'INFO',
      at: new Date(),
    });
    expect(withModel.modelUrl).toContain('/models/model-1');

    const withoutModel = buildNotificationMessage({
      modelId: null,
      modelName: 'Test notification',
      workspaceName: '',
      axis: null,
      title: 't',
      detail: 'd',
      severity: 'INFO',
      at: new Date(),
    });
    expect(withoutModel.modelUrl).not.toContain('/models/');
  });

  it('renders frozen columns with their flat duration', () => {
    const msg = buildNotificationMessage({
      modelId: 'model-1',
      modelName: 'M',
      workspaceName: 'W',
      axis: 'MONITORING',
      title: 't',
      detail: 'normal -> frozen',
      severity: 'WARNING',
      frozenColumns: [{ column: 'TI101', flatMinutes: 90 }],
      at: new Date(),
    });
    expect(msg.bodyText).toContain('TI101 (flat 90min)');
  });
});

describe('monitoringTransitionDetail — five-word vocabulary (D02/D09)', () => {
  it('uses the same wording the Model Detail badge uses, with the reason parenthesised', () => {
    expect(
      monitoringTransitionDetail(
        'WARN',
        'ALERT',
        'SOURCE_UNREACHABLE',
        'running',
      ),
    ).toBe('warning -> alert (Source unreachable)');
  });

  it('reads offline when deploy is stopped or error, regardless of health', () => {
    expect(monitoringTransitionDetail(null, 'OK', null, 'stopped')).toBe(
      'offline',
    );
    expect(monitoringTransitionDetail(null, 'ALERT', 'STALE', 'error')).toBe(
      'offline (No recent windows)',
    );
  });

  it('omits the "from" side on a first-ever notified transition', () => {
    expect(
      monitoringTransitionDetail(null, 'WARN', 'DRIFT_WARN', 'running'),
    ).toBe('warning (Input drift)');
  });
});
