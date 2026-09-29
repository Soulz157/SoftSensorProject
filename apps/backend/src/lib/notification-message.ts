import { env } from '@/config/env.config';
import { redactUrls } from './redact-urls';
import type { HealthReason, HealthStatus } from './model-health';
import type { DeployStatus } from './deploy-status';
import {
  monitoringStatusFromHealth,
  type EffectiveProdStatus,
} from './notification-monitoring-status';
import { formatHealthReason } from './notification-health-reason-label';

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
}

/** Wall-clock time in UTC — no plant-local timezone field exists on Model,
 *  Workspace or WorkspacePlant today (checked at T01), so plant-local
 *  cannot be shown without inventing one; UTC is the honest single value
 *  available. */
function formatTimestamp(at: Date): string {
  return `${at.toISOString()} UTC`;
}

export function buildNotificationMessage(
  input: NotificationMessageInput,
): RenderedMessage {
  const modelUrl = input.modelId
    ? `${env.CLIENT_APP_URL}/models/${input.modelId}`
    : env.CLIENT_APP_URL;
  const lines: string[] = [
    `${input.workspaceName} / ${input.modelName}`,
    input.detail,
  ];

  if (input.rawDetailSuffix) {
    lines.push(redactUrls(input.rawDetailSuffix));
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

  lines.push(formatTimestamp(input.at));
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
  const htmlBody = escapeHtml(msg.bodyText).replace(/\n/g, '<br/>');
  return {
    text: msg.bodyText,
    html: `<p><strong>${escapeHtml(msg.title)}</strong></p><p>${htmlBody}</p>`,
  };
}
