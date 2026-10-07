import { env } from '@/config/env.config';
import {
  buildDigestMessage,
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
    ).toBe('warning (PSI input drift)');
  });
});

describe('workspace digest (MODEL-SERVE-031)', () => {
  const digest = {
    workspaceName: 'ROC Plant',
    total: 12,
    alertCount: 1,
    warningCount: 1,
    frozenCount: 0,
    offlineCount: 0,
    legend: {
      warn: 0.1,
      critical: 0.25,
      outOfRangeWarnPct: 5,
      outOfRangeCriticalPct: 20,
    },
    changes: [{ model: 'TS-101', from: 'warning', to: 'alert' }],
    longest: {
      model: '<script>x</script>',
      status: 'alert' as const,
      since: '2026-10-05T06:15:00.000Z',
      minutes: 3060,
    },
    rows: [
      {
        modelId: 'm1',
        model: '<script>x</script>',
        status: 'alert' as const,
        reason: 'Drift',
        worstInput: 'FI-1001',
        psi: 0.31,
        psiBand: 'crit' as const,
        outOfRangePct: 24,
        outOfRangeBand: 'crit' as const,
        sdRatio: null,
        sdBand: null,
        warnSd: 1.5,
        criticalSd: 3,
        since: '2026-10-05T06:15:00.000Z',
        openMinutes: 3060,
      },
      {
        modelId: 'm2',
        model: 'FLASH-303',
        status: 'warning' as const,
        reason: 'Residual SD',
        worstInput: null,
        psi: 0.14,
        psiBand: 'warn' as const,
        outOfRangePct: 6.5,
        outOfRangeBand: 'warn' as const,
        sdRatio: 2.1,
        sdBand: 'warn' as const,
        warnSd: 1.5,
        criticalSd: 3,
        since: null,
        openMinutes: null,
      },
    ],
  };
  const msg = buildDigestMessage({
    digest,
    workspaceId: 'ws-1',
    at: new Date('2026-10-07T09:15:00.000Z'),
  });

  it('states how many models need attention, with the cutoffs in the legend', () => {
    expect(msg.title).toContain('2 of 12 models need attention');
    expect(msg.bodyText).toContain('0.31 CRIT');
    expect(msg.bodyText).toContain('2.1x WARN');
    expect(msg.bodyText).toContain('1.5x / 3.0x');
    expect(msg.bodyText).toContain('PSI: green < 0.1, yellow 0.1-0.25');
    expect(msg.bodyText).toContain(
      'Changed this check: TS-101 warning -> alert',
    );
    expect(msg.bodyText).toContain('Timestamp: 7 Oct 2026 09:15 UTC');
  });

  it('prints an all-clear line for a recovery-only digest', () => {
    const clear = buildDigestMessage({
      digest: {
        ...digest,
        rows: [],
        alertCount: 0,
        warningCount: 0,
        longest: null,
      },
      workspaceId: 'ws-1',
      at: new Date('2026-10-07T09:15:00.000Z'),
    });
    expect(clear.title).toContain('0 of 12 models need attention — all clear');
  });

  it('draws a Teams ColumnSet row per model, coloured and labelled', () => {
    const card = JSON.stringify(renderTeamsCard(msg));
    expect(card).toContain('"type":"ColumnSet"');
    expect(card).toContain('"color":"Attention"');
    expect(card).toContain('"color":"Warning"');
    expect(card).toContain('0.31 CRIT');
  });

  it('links every digest row to its own model page in all three renderings', () => {
    const urlFor = (id: string) => `${env.CLIENT_APP_URL}/models/${id}`;
    expect(msg.bodyText).toContain(`  Open FLASH-303: ${urlFor('m2')}`);
    const card = JSON.stringify(renderTeamsCard(msg));
    expect(card).toContain(`"url":"${urlFor('m1')}"`);
    expect(card).toContain(`"url":"${urlFor('m2')}"`);
    expect(card.match(/"type":"ActionSet"/g)).toHaveLength(2);
    const { html } = renderEmail(msg);
    expect(html).toContain(`href="${urlFor('m1')}"`);
    expect(html).toContain(`href="${urlFor('m2')}"`);
  });

  it('puts the links UNDER the table, each after a one-line description', () => {
    const body = msg.bodyText;
    const tableEnd = body.lastIndexOf('| FLASH-303');
    const models = body.indexOf('Models:');
    expect(models).toBeGreaterThan(tableEnd);
    // Worst-graded metric wins: TS row is PSI CRIT; FLASH-303's three
    // metrics are all WARN, so the first (PSI) is shown.
    expect(body).toContain('FLASH-303 — WARNING · Residual SD · PSI 0.14 WARN');
    expect(body).toContain('ALERT · Drift · PSI 0.31 CRIT on FI-1001');

    const card = JSON.stringify(renderTeamsCard(msg));
    expect(card).toContain('"title":"Open FLASH-303"');
    // No button column left inside the table rows.
    expect(card.indexOf('"type":"ActionSet"')).toBeGreaterThan(
      card.lastIndexOf('"type":"ColumnSet"'),
    );

    const { html } = renderEmail(msg);
    expect(html.indexOf('Open FLASH-303')).toBeGreaterThan(
      html.indexOf('</table>'),
    );
    // Model name in the button is escaped too.
    expect(html).toContain('Open &lt;script&gt;x&lt;/script&gt;');
  });

  it('draws an e-mail <table> and escapes user-controlled model names', () => {
    const { html, text } = renderEmail(msg);
    expect(html).toContain('<table');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(text).toBe(msg.bodyText);
  });

  it('says how long each model has been in its status, and which is longest', () => {
    // 3060 minutes = 2d 3h, since 5 Oct 06:15 UTC.
    expect(msg.bodyText).toContain(
      'Longest: <script>x</script> — ALERT for 2d 3h, since 5 Oct 2026 06:15 UTC',
    );
    expect(msg.bodyText).toMatch(/\| Since +\|/);
    expect(msg.bodyText).toContain('since 5 Oct 2026 06:15 UTC (2d 3h)');
    // A row with no known since-time shows a dash and no "since" phrase.
    expect(msg.bodyText).not.toContain(
      'FLASH-303 — WARNING · Residual SD · PSI 0.14 WARN · since',
    );

    const card = JSON.stringify(renderTeamsCard(msg));
    expect(card).toContain('"text":"Since"');
    expect(card).toContain('"text":"2d 3h"');
    expect(card).toContain('Longest: <script>x</script> — ALERT for 2d 3h');

    const { html } = renderEmail(msg);
    expect(html).toContain(
      'Longest: &lt;script&gt;x&lt;/script&gt; — ALERT for 2d 3h',
    );
    expect(html.indexOf('Longest:')).toBeLessThan(html.indexOf('<table'));
  });

  it('keeps the Teams header and data rows the same width', () => {
    const card = renderTeamsCard(msg) as {
      attachments: {
        content: { body: { type: string; columns?: unknown[] }[] };
      }[];
    };
    const sets = card.attachments[0].content.body.filter(
      (b) => b.type === 'ColumnSet',
    );
    const widths = new Set(sets.map((b) => b.columns?.length));
    expect(widths.size).toBe(1);
  });

  it('gives Status and Reason their own Teams columns, same order as the text table', () => {
    const card = renderTeamsCard(msg) as {
      attachments: {
        content: {
          body: {
            type: string;
            columns?: { items: { text: string }[] }[];
          }[];
        };
      }[];
    };
    const sets = card.attachments[0].content.body.filter(
      (b) => b.type === 'ColumnSet',
    );
    const texts = (i: number) =>
      (sets[i].columns ?? []).map((c) => c.items[0].text);
    expect(texts(0)).toEqual([
      'Model',
      'Status',
      'Since',
      'Reason',
      'PSI',
      'OoR %',
      'SD ratio',
    ]);
    expect(texts(1).slice(1, 4)).toEqual(['ALERT', '2d 3h', 'Drift']);
  });

  it('still renders a legacy payload that has no digest field', () => {
    const legacy = { title: 't', bodyText: 'a\nb', modelUrl: 'u' };
    expect(renderEmail(legacy).html).toContain('a<br/>b');
    expect(JSON.stringify(renderTeamsCard(legacy))).not.toContain('ColumnSet');
  });
});
