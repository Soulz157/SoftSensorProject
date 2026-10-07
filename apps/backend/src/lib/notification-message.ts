import { env } from '@/config/env.config';
import { redactUrls } from './redact-urls';
import type { HealthReason, HealthStatus } from './model-health';
import type { DeployStatus } from './deploy-status';
import {
  monitoringStatusFromHealth,
  type EffectiveProdStatus,
} from './notification-monitoring-status';
import { formatHealthReason } from './notification-health-reason-label';
import type { DigestBand, DigestData, DigestRow } from './notification-digest';

/**
 * MODEL-SERVE-022-T04. ONE message builder, rendered by two channel-specific
 * functions below — D02's one-decider rule extended to wording: every
 * channel says the same thing about the same transition.
 */
export interface NotificationMessageInput {
  /** Null for a "send test notification" — no real model is behind it. */
  modelId: string | null;
  modelName: string;
  workspaceName: string;
  /** Null for a discrete event with no axis reading (e.g. VERSION_PROMOTED). */
  axis: 'DEPLOY' | 'MONITORING' | null;
  title: string;
  /** Human sentence for the transition, e.g. "Warning -> Alert (source
   *  unreachable)" or "Retrain succeeded — v4 staged". Built by the caller,
   *  since only it knows which event this is. */
  detail: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  frozenColumns?: { column: string; flatMinutes: number | null }[];
  /** Any free text that may carry a presigned URL (failureReason,
   *  preflightReason) — REDACTED HERE, once, so every caller gets the same
   *  guarantee rather than remembering to call redactUrls itself (V02). */
  rawDetailSuffix?: string | null;
  at: Date;
}

export interface RenderedMessage {
  title: string;
  bodyText: string;
  /** Pre-redacted, ready to persist as `NotificationDelivery.payload` —
   *  the row is itself a sink (V02), so redaction happens before this
   *  object is ever returned, not after. */
  modelUrl: string;
  /** MODEL-SERVE-031. Present only on a workspace digest — the structured
   *  rows the Teams/e-mail renderers turn into a table. `bodyText` always
   *  carries the plain-text version, so a payload stored before this field
   *  existed (or a channel that cannot draw a table) still renders. */
  digest?: DigestData;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Wall-clock time in UTC — no plant-local timezone field exists on Model,
 *  Workspace or WorkspacePlant today (checked at T01), so plant-local
 *  cannot be shown without inventing one; UTC is the honest single value
 *  available.
 *
 * Rendered as "29 Sep 2026 06:23 UTC" rather than the raw ISO
 * string — a reader opening this from a phone notification or a Teams
 * card should not have to parse `2026-09-29T06:23:21.724Z` themselves.
 * Uses the UTC getters directly (no date library added for one function —
 * this codebase has no date-formatting dependency in the backend). */
function formatTimestamp(at: Date): string {
  const day = at.getUTCDate();
  const month = MONTH_NAMES[at.getUTCMonth()];
  const year = at.getUTCFullYear();
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm} UTC`;
}

export function buildNotificationMessage(
  input: NotificationMessageInput,
): RenderedMessage {
  const modelUrl = input.modelId
    ? `${env.CLIENT_APP_URL}/models/${input.modelId}`
    : env.CLIENT_APP_URL;
  const lines: string[] = [
    `Workspace: ${input.workspaceName}`,
    `Model: ${input.modelName}`,
    `Detail: ${input.detail}`,
  ];

  if (input.rawDetailSuffix) {
    lines.push(`Reason: ${redactUrls(input.rawDetailSuffix)}`);
  }

  if (input.frozenColumns && input.frozenColumns.length > 0) {
    const cols = input.frozenColumns
      .map((f) =>
        f.flatMinutes !== null
          ? `${f.column} (flat ${f.flatMinutes}min)`
          : f.column,
      )
      .join(', ');
    lines.push(`Frozen: ${cols}`);
  }

  lines.push(`Timestamp: ${formatTimestamp(input.at)}`);
  lines.push(modelUrl);

  return {
    title: input.title,
    bodyText: lines.join('\n'),
    modelUrl,
  };
}

/**
 * The five-word vocabulary sentence for a MONITORING transition — shared by
 * every monitoring-axis event so the wording matches the Model Detail badge
 * (D02/D09).
 */
export function monitoringTransitionDetail(
  fromStatus: HealthStatus | null,
  toStatus: HealthStatus,
  toReason: HealthReason | null,
  deploy: DeployStatus | undefined,
): string {
  const toLabel: EffectiveProdStatus = monitoringStatusFromHealth(
    toStatus,
    deploy,
  );
  const reasonLabel = formatHealthReason(toReason);
  const fromLabel: EffectiveProdStatus | null =
    fromStatus !== null ? monitoringStatusFromHealth(fromStatus, deploy) : null;
  const arrow = fromLabel !== null ? `${fromLabel} -> ${toLabel}` : toLabel;
  return reasonLabel ? `${arrow} (${reasonLabel})` : arrow;
}

// ── Teams Workflows (Adaptive Card) ─────────────────────────────────────────

/**
 * D05: a Power Automate / Teams Workflows "webhook request received" URL
 * expects the FLOW's own envelope, not the legacy O365 `{text}` shape — an
 * Adaptive Card inside an `attachments` array is the documented, supported
 * body for that trigger.
 */
export function renderTeamsCard(msg: RenderedMessage): unknown {
  if (msg.digest) return renderTeamsDigestCard(msg, msg.digest);
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: msg.title,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: msg.bodyText,
              wrap: true,
            },
          ],
          actions: [
            {
              type: 'Action.OpenUrl',
              title: 'Open model',
              url: msg.modelUrl,
            },
          ],
        },
      },
    ],
  };
}

// ── E-mail ───────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmail(msg: RenderedMessage): {
  html: string;
  text: string;
} {
  if (msg.digest) {
    return {
      text: msg.bodyText,
      html: renderDigestHtml(msg.title, msg.digest),
    };
  }
  const htmlBody = escapeHtml(msg.bodyText).replace(/\n/g, '<br/>');
  return {
    text: msg.bodyText,
    html: `<p><strong>${escapeHtml(msg.title)}</strong></p><p>${htmlBody}</p>`,
  };
}

// ── Workspace digest (MODEL-SERVE-031) ─────────────────────────────────────

const BAND_LABEL: Record<DigestBand, string> = {
  ok: 'OK',
  warn: 'WARN',
  crit: 'CRIT',
};
const BAND_TEAMS_COLOR: Record<DigestBand, string> = {
  ok: 'Good',
  warn: 'Warning',
  crit: 'Attention',
};
// Inline-style colours for e-mail clients, which strip <style> blocks.
const BAND_HEX: Record<DigestBand, string> = {
  ok: '#15803d',
  warn: '#b45309',
  crit: '#b91c1c',
};
const BAND_DOT: Record<DigestBand, string> = {
  ok: '🟢',
  warn: '🟡',
  crit: '🔴',
};

/** Per-model deep link, resolved at render time from the row's `modelId` so
 *  a payload stored before this existed still gets buttons. */
function digestModelUrl(modelId: string): string {
  return `${env.CLIENT_APP_URL}/models/${modelId}`;
}

const BAND_RANK: Record<DigestBand, number> = { ok: 0, warn: 1, crit: 2 };

/** One-line description shown above each model's button under the table:
 *  status, reason, and the single worst-graded metric (the one that most
 *  explains the status). Shared by text, Teams and e-mail. */
function rowDescription(r: DigestRow): string {
  const parts = [`${r.model} — ${r.status.toUpperCase()}`, r.reason];
  const candidates: { band: DigestBand; text: string }[] = [];
  if (r.psiBand && r.psi !== null) {
    candidates.push({
      band: r.psiBand,
      text: `PSI ${r.psi.toFixed(2)} ${BAND_LABEL[r.psiBand]}${r.worstInput ? ` on ${r.worstInput}` : ''}`,
    });
  }
  if (r.outOfRangeBand && r.outOfRangePct !== null) {
    candidates.push({
      band: r.outOfRangeBand,
      text: `OoR ${r.outOfRangePct.toFixed(1)}% ${BAND_LABEL[r.outOfRangeBand]}`,
    });
  }
  if (r.sdBand && r.sdRatio !== null) {
    const band =
      r.warnSd !== null && r.criticalSd !== null
        ? ` (band ${r.warnSd.toFixed(1)}x / ${r.criticalSd.toFixed(1)}x)`
        : '';
    candidates.push({
      band: r.sdBand,
      text: `SD ratio ${r.sdRatio.toFixed(1)}x ${BAND_LABEL[r.sdBand]}${band}`,
    });
  }
  const worst = candidates.reduce<(typeof candidates)[number] | null>(
    (w, c) => (w === null || BAND_RANK[c.band] > BAND_RANK[w.band] ? c : w),
    null,
  );
  if (worst) parts.push(worst.text);
  const since = sinceText(r);
  if (since) parts.push(since);
  return parts.join(' · ');
}

/** "45m", "3h 20m", "2d 4h" — how long a model has been in its status. */
function fmtDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function sinceText(r: {
  since: string | null;
  openMinutes: number | null;
}): string | null {
  if (r.since === null) return null;
  return `since ${formatTimestamp(new Date(r.since))} (${fmtDuration(r.openMinutes)})`;
}

/** "Longest: TS — ALERT for 2d 4h, since 5 Oct 2026 06:23 UTC". */
function longestLine(d: DigestData): string | null {
  if (!d.longest) return null;
  const l = d.longest;
  return `Longest: ${l.model} — ${l.status.toUpperCase()} for ${fmtDuration(l.minutes)}, since ${formatTimestamp(new Date(l.since))}`;
}

function fmtNum(v: number | null, digits: number, suffix = ''): string {
  return v === null ? '—' : `${v.toFixed(digits)}${suffix}`;
}

interface DigestCell {
  text: string;
  band: DigestBand | null;
}

/** One row as display cells — the single place number formatting lives, so
 *  the text, Teams and e-mail tables cannot disagree. */
function digestCells(r: DigestRow): DigestCell[] {
  const band =
    r.warnSd !== null && r.criticalSd !== null
      ? `${r.warnSd.toFixed(1)}x / ${r.criticalSd.toFixed(1)}x`
      : '—';
  return [
    { text: r.model, band: null },
    { text: r.status.toUpperCase(), band: null },
    { text: fmtDuration(r.openMinutes), band: null },
    { text: r.reason, band: null },
    { text: r.worstInput ?? '—', band: null },
    { text: fmtNum(r.psi, 2), band: r.psiBand },
    { text: fmtNum(r.outOfRangePct, 1), band: r.outOfRangeBand },
    { text: fmtNum(r.sdRatio, 1, 'x'), band: r.sdBand },
    { text: band, band: null },
  ];
}

const DIGEST_HEADERS = [
  'Model',
  'Status',
  'Since',
  'Reason',
  'Worst input',
  'PSI',
  'OoR %',
  'SD ratio',
  'Band (warn/crit)',
];

function cellText(c: DigestCell): string {
  return c.band ? `${c.text} ${BAND_LABEL[c.band]}` : c.text;
}

function legendLines(d: DigestData): string[] {
  const l = d.legend;
  return [
    'Band legend (green OK / yellow WARN / red CRIT):',
    `PSI: green < ${l.warn}, yellow ${l.warn}-${l.critical}, red >= ${l.critical}`,
    `OoR %: green < ${l.outOfRangeWarnPct}%, yellow ${l.outOfRangeWarnPct}-${l.outOfRangeCriticalPct}%, red >= ${l.outOfRangeCriticalPct}%`,
    'SD ratio (live SD / baseline SD): green < warn, yellow warn to < crit, red >= crit (the warn/crit band is set per model)',
  ];
}

function digestHeadline(d: DigestData): string {
  const parts: string[] = [];
  if (d.alertCount > 0) parts.push(`${d.alertCount} alert`);
  if (d.warningCount > 0) parts.push(`${d.warningCount} warning`);
  if (d.frozenCount > 0) parts.push(`${d.frozenCount} frozen`);
  if (d.offlineCount > 0) parts.push(`${d.offlineCount} offline`);
  const issues = d.rows.length;
  if (issues === 0) {
    return `${d.workspaceName}: 0 of ${d.total} models need attention — all clear`;
  }
  return `${d.workspaceName}: ${issues} of ${d.total} models need attention (${parts.join(', ')})`;
}

function changeLines(d: DigestData): string[] {
  if (d.changes.length === 0) return [];
  return [
    `Changed this check: ${d.changes
      .map((c) => `${c.model} ${c.from ?? 'new'} -> ${c.to}`)
      .join(' · ')}`,
  ];
}

export function buildDigestMessage(input: {
  digest: DigestData;
  workspaceId: string;
  at: Date;
}): RenderedMessage {
  const d = input.digest;
  const title = `SoftSensor monitoring — ${digestHeadline(d)}`;
  const modelUrl = `${env.CLIENT_APP_URL}/workspaces/${input.workspaceId}`;

  const lines: string[] = [digestHeadline(d)];
  const longest = longestLine(d);
  if (longest) lines.push(longest);
  if (d.rows.length > 0) {
    const table = [
      DIGEST_HEADERS,
      ...d.rows.map((r) => digestCells(r).map(cellText)),
    ];
    const widths = DIGEST_HEADERS.map((_, i) =>
      Math.max(...table.map((row) => row[i].length)),
    );
    const fmt = (row: string[]) =>
      `| ${row.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
    lines.push('', fmt(table[0]));
    lines.push(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
    for (const row of table.slice(1)) lines.push(fmt(row));
  }
  if (d.rows.length > 0) {
    lines.push('', 'Models:');
    for (const r of d.rows) {
      lines.push(rowDescription(r));
      lines.push(`  Open ${r.model}: ${digestModelUrl(r.modelId)}`);
    }
  }
  lines.push('', ...legendLines(d));
  const changes = changeLines(d);
  if (changes.length > 0) lines.push('', ...changes);
  lines.push('', `Timestamp: ${formatTimestamp(input.at)}`, modelUrl);

  return { title, bodyText: lines.join('\n'), modelUrl, digest: d };
}

function renderTeamsDigestCard(msg: RenderedMessage, d: DigestData): unknown {
  const col = (text: string, opts: Record<string, unknown> = {}) => ({
    type: 'Column',
    width: 'stretch',
    items: [{ type: 'TextBlock', text, wrap: true, size: 'Small', ...opts }],
  });
  const header = {
    type: 'ColumnSet',
    columns: [
      ...['Model', 'Status', 'Since', 'Reason', 'PSI', 'OoR %', 'SD ratio'].map(
        (h) => col(h, { weight: 'Bolder' }),
      ),
    ],
  };
  const rows = d.rows.map((r) => {
    const cells = digestCells(r);
    const bandCol = (c: DigestCell) =>
      col(cellText(c), c.band ? { color: BAND_TEAMS_COLOR[c.band] } : {});
    const sdBand =
      r.warnSd !== null && r.criticalSd !== null
        ? ` (${r.warnSd.toFixed(1)}/${r.criticalSd.toFixed(1)})`
        : '';
    return {
      type: 'ColumnSet',
      separator: true,
      columns: [
        col(r.model),
        col(cells[1].text),
        col(cells[2].text),
        col(cells[3].text),
        bandCol(cells[5]),
        bandCol(cells[6]),
        col(
          `${cellText(cells[7])}${sdBand}`,
          cells[7].band ? { color: BAND_TEAMS_COLOR[cells[7].band] } : {},
        ),
      ],
    };
  });
  // Under the table: one block per model — description, then its button.
  const modelBlocks =
    d.rows.length === 0
      ? []
      : [
          {
            type: 'TextBlock',
            text: 'Models',
            weight: 'Bolder',
            spacing: 'Medium',
            wrap: true,
          },
          ...d.rows.map((r) => ({
            type: 'Container',
            spacing: 'Small',
            items: [
              {
                type: 'TextBlock',
                text: rowDescription(r),
                wrap: true,
                size: 'Small',
              },
              {
                type: 'ActionSet',
                actions: [
                  {
                    type: 'Action.OpenUrl',
                    title: `Open ${r.model}`,
                    url: digestModelUrl(r.modelId),
                  },
                ],
              },
            ],
          })),
        ];
  const footer = [
    ...changeLines(d),
    ...legendLines(d),
    `Timestamp: ${
      msg.bodyText
        .split('\n')
        .find((l) => l.startsWith('Timestamp: '))
        ?.slice(11) ?? ''
    }`,
  ].map((text) => ({
    type: 'TextBlock',
    text,
    wrap: true,
    size: 'Small',
    isSubtle: true,
  }));

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: msg.title,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            },
            ...(longestLine(d)
              ? [
                  {
                    type: 'TextBlock',
                    text: longestLine(d),
                    wrap: true,
                    weight: 'Bolder',
                    color: 'Attention',
                  },
                ]
              : []),
            ...(d.rows.length > 0 ? [header, ...rows] : []),
            ...modelBlocks,
            ...footer,
          ],
          actions: [
            {
              type: 'Action.OpenUrl',
              title: 'Open workspace',
              url: msg.modelUrl,
            },
          ],
        },
      },
    ],
  };
}

function openButton(r: DigestRow): string {
  return `<a href="${escapeHtml(digestModelUrl(r.modelId))}" style="display:inline-block;padding:4px 12px;border-radius:6px;background:#18181b;color:#ffffff;font-size:12px;text-decoration:none">Open ${escapeHtml(r.model)}</a>`;
}

function renderDigestHtml(title: string, d: DigestData): string {
  const th =
    'style="text-align:left;padding:4px 8px;border-bottom:1px solid #d4d4d8;font-size:12px"';
  const td =
    'style="padding:4px 8px;border-bottom:1px solid #f4f4f5;font-size:13px"';
  const cell = (c: DigestCell): string => {
    const text = escapeHtml(c.text);
    if (!c.band) return `<td ${td}>${text}</td>`;
    return `<td ${td}><span style="color:${BAND_HEX[c.band]};font-weight:600">${BAND_DOT[c.band]} ${text} ${BAND_LABEL[c.band]}</span></td>`;
  };
  const table =
    d.rows.length === 0
      ? ''
      : `<table style="border-collapse:collapse;margin:8px 0"><thead><tr>${DIGEST_HEADERS.map((h) => `<th ${th}>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${d.rows
          .map((r) => `<tr>${digestCells(r).map(cell).join('')}</tr>`)
          .join('')}</tbody></table>`;
  const models =
    d.rows.length === 0
      ? ''
      : `<p style="margin:12px 0 4px;font-weight:600">Models</p>${d.rows
          .map(
            (r) =>
              `<div style="margin:0 0 10px"><div style="font-size:13px;margin-bottom:4px">${escapeHtml(rowDescription(r))}</div>${openButton(r)}</div>`,
          )
          .join('')}`;
  const legend = legendLines(d)
    .map((l) => escapeHtml(l))
    .join('<br/>');
  const changes = changeLines(d)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('');
  const longest = longestLine(d);
  const longestHtml = longest
    ? `<p style="color:#b91c1c;font-weight:600;margin:4px 0">${escapeHtml(longest)}</p>`
    : '';
  return `<p><strong>${escapeHtml(title)}</strong></p>${longestHtml}${table}${models}<p style="color:#52525b;font-size:12px">${legend}</p>${changes}`;
}
