import type { HealthReason, HealthStatus } from './model-health';
import {
  outOfRangeStatusFor,
  statusFor,
  type PsiReport,
  type PsiThresholds,
} from './prediction-psi';

/**
 * MODEL-SERVE-031. Pure derivation for the workspace monitoring digest — no
 * I/O, no Prisma. The evaluator persists `DigestMetrics` on every pass
 * (`ModelAlertState.metrics`); the digest is built from those persisted rows,
 * never from whatever subset of models one sweep happened to evaluate.
 */

/** Worst-column PSI beside the verdict. Both numbers are null when no column
 *  has a computed value (INSUFFICIENT_DATA / UNKNOWN) — rendered as "—". */
export interface PsiSummary {
  worstColumn: string | null;
  worstPsi: number | null;
  maxOutOfRangePct: number | null;
}

/** What is stored in `ModelAlertState.metrics` (a Json column). */
export interface DigestMetrics {
  worstPsiColumn: string | null;
  worstPsi: number | null;
  maxOutOfRangePct: number | null;
  sdRatio: number | null;
  warnSd: number | null;
  criticalSd: number | null;
  /** The deploy-aware five-word status (`monitoringStatusFromHealth`) as of
   *  the last evaluation — the SAME word the bell and the "Changed" line
   *  use. Without it a stopped model reads ALERT in the table and "offline"
   *  in the footer. Absent on rows written before MODEL-SERVE-031 shipped it. */
  statusWord: string | null;
  /** ISO time the model ENTERED `statusWord` — carried forward unchanged
   *  while the word stays the same, reset when it changes. Drives the
   *  digest's "Since" column and its "Longest" line. */
  statusSince: string | null;
}

export type DigestBand = 'ok' | 'warn' | 'crit';
export type DigestStatusWord = 'alert' | 'warning' | 'frozen' | 'offline';

/** The cutoffs the legend prints — read from env at the call site, never
 *  hardcoded here, so the legend cannot disagree with the grading. */
export type DigestThresholds = Pick<
  PsiThresholds,
  'warn' | 'critical' | 'outOfRangeWarnPct' | 'outOfRangeCriticalPct'
>;

export interface DigestRow {
  modelId: string;
  model: string;
  status: DigestStatusWord;
  reason: string;
  worstInput: string | null;
  psi: number | null;
  psiBand: DigestBand | null;
  outOfRangePct: number | null;
  outOfRangeBand: DigestBand | null;
  sdRatio: number | null;
  sdBand: DigestBand | null;
  warnSd: number | null;
  criticalSd: number | null;
  /** When this model entered its current status, and how long ago that was
   *  at digest time. Null when unknown. */
  since: string | null;
  openMinutes: number | null;
}

/** The model that has been in a problem state the longest. */
export interface DigestLongest {
  model: string;
  status: DigestStatusWord;
  since: string;
  minutes: number;
}

export interface DigestChange {
  model: string;
  from: string | null;
  to: string;
}

export interface DigestData {
  workspaceName: string;
  /** Models the channel watches (the "M" of "N of M"). */
  total: number;
  alertCount: number;
  warningCount: number;
  frozenCount: number;
  offlineCount: number;
  rows: DigestRow[];
  legend: DigestThresholds;
  changes: DigestChange[];
  longest: DigestLongest | null;
}

export interface DigestStateInput {
  modelId: string;
  modelName: string;
  status: string;
  reason: string | null;
  frozenColumns: string[];
  metrics: unknown;
}

export function summarizePsi(report: PsiReport): PsiSummary {
  let worstColumn: string | null = null;
  let worstPsi: number | null = null;
  let maxOutOfRangePct: number | null = null;
  for (const c of report.columns) {
    if (c.psi !== null && (worstPsi === null || c.psi > worstPsi)) {
      worstPsi = c.psi;
      worstColumn = c.column;
    }
    if (
      c.outOfRangePct !== null &&
      (maxOutOfRangePct === null || c.outOfRangePct > maxOutOfRangePct)
    ) {
      maxOutOfRangePct = c.outOfRangePct;
      if (worstColumn === null) worstColumn = c.column;
    }
  }
  return { worstColumn, worstPsi, maxOutOfRangePct };
}

export function buildMetrics(input: {
  psiSummary: PsiSummary | null;
  sdRatio: number | null;
  thresholds: { warnSd: number; criticalSd: number } | null;
  statusWord: string | null;
  statusSince: string | null;
}): DigestMetrics {
  return {
    worstPsiColumn: input.psiSummary?.worstColumn ?? null,
    worstPsi: input.psiSummary?.worstPsi ?? null,
    maxOutOfRangePct: input.psiSummary?.maxOutOfRangePct ?? null,
    sdRatio: input.sdRatio,
    warnSd: input.thresholds?.warnSd ?? null,
    criticalSd: input.thresholds?.criticalSd ?? null,
    statusWord: input.statusWord,
    statusSince: input.statusSince,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The Json column is untyped at rest; narrow it field by field. */
export function parseMetrics(raw: unknown): DigestMetrics | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    worstPsiColumn: strOrNull(o.worstPsiColumn),
    worstPsi: numOrNull(o.worstPsi),
    maxOutOfRangePct: numOrNull(o.maxOutOfRangePct),
    sdRatio: numOrNull(o.sdRatio),
    warnSd: numOrNull(o.warnSd),
    criticalSd: numOrNull(o.criticalSd),
    statusWord: strOrNull(o.statusWord),
    statusSince: strOrNull(o.statusSince),
  };
}

/**
 * When the model entered its CURRENT status word.
 * - Same word as the persisted metrics: keep their `statusSince`.
 * - A row written before metrics existed (pre-MODEL-SERVE-031): its
 *   `updatedAt` only moved on a status change back then, so it IS the
 *   since-time when the raw status is unchanged.
 * - Anything else (new row, changed word, since missing): now.
 */
export function resolveStatusSince(input: {
  prevMetrics: DigestMetrics | null;
  prevStatus: string | null;
  prevUpdatedAt: Date | null;
  nextStatus: string;
  nextWord: string;
  now: Date;
}): string {
  const { prevMetrics, now } = input;
  if (prevMetrics && prevMetrics.statusWord !== null) {
    return prevMetrics.statusWord === input.nextWord && prevMetrics.statusSince
      ? prevMetrics.statusSince
      : now.toISOString();
  }
  if (
    !prevMetrics &&
    input.prevStatus === input.nextStatus &&
    input.prevUpdatedAt
  ) {
    return input.prevUpdatedAt.toISOString();
  }
  return now.toISOString();
}

function fromStatus(s: string): DigestBand {
  if (s === 'CRITICAL') return 'crit';
  if (s === 'WARN') return 'warn';
  return 'ok';
}

export function psiBandFor(
  psi: number | null,
  t: DigestThresholds,
): DigestBand | null {
  if (psi === null) return null;
  return fromStatus(statusFor(psi, { ...t, minSamplesPerBin: 0 }));
}

export function outOfRangeBandFor(
  pct: number | null,
  t: DigestThresholds,
): DigestBand | null {
  if (pct === null) return null;
  return fromStatus(outOfRangeStatusFor(pct, { ...t, minSamplesPerBin: 0 }));
}

/** Same `>=` rule as `classifyResidualSd`. */
export function sdBandFor(
  ratio: number | null,
  warnSd: number | null,
  criticalSd: number | null,
): DigestBand | null {
  if (ratio === null || warnSd === null || criticalSd === null) return null;
  if (ratio >= criticalSd) return 'crit';
  if (ratio >= warnSd) return 'warn';
  return 'ok';
}

/** Short on purpose: the long `formatHealthReason` wording ("residual
 *  1–2SD") would contradict the band column printed beside it. */
const SHORT_REASON: Record<HealthReason, string> = {
  SOURCE_UNREACHABLE: 'Source down',
  STALE: 'Stale',
  NO_PREDICTIONS: 'No predictions',
  BAD_DATA: 'Bad data',
  SENSOR_FROZEN: 'Frozen',
  DRIFT_CRITICAL: 'Drift',
  DRIFT_WARN: 'Drift',
  RESIDUAL_SD_CRITICAL: 'Residual SD',
  RESIDUAL_SD_WARN: 'Residual SD',
};

export function shortReason(reason: string | null): string {
  if (reason && reason in SHORT_REASON) {
    return SHORT_REASON[reason as HealthReason];
  }
  return reason ?? '—';
}

/** The persisted deploy-aware word wins; the raw health status is only the
 *  fallback for a row that has none. 'normal' is never a problem row. */
function statusWord(
  status: string,
  persisted: string | null,
): DigestStatusWord | null {
  if (persisted === 'alert') return 'alert';
  if (persisted === 'warning') return 'warning';
  if (persisted === 'frozen') return 'frozen';
  if (persisted === 'offline') return 'offline';
  if (persisted === 'normal') return null;
  const s = status as HealthStatus;
  if (s === 'ALERT' || s === 'CRITICAL') return 'alert';
  if (s === 'WARN') return 'warning';
  if (s === 'FROZEN') return 'frozen';
  return null;
}

const WORD_RANK: Record<DigestStatusWord, number> = {
  alert: 0,
  offline: 1,
  frozen: 2,
  warning: 3,
};

/** Only models in a problem state become rows; worst first, then by name. */
function minutesSince(since: string | null, now: Date): number | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 60_000));
}

export function buildDigestRows(
  states: DigestStateInput[],
  legend: DigestThresholds,
  now: Date = new Date(),
): DigestRow[] {
  const rows: DigestRow[] = [];
  for (const st of states) {
    const m = parseMetrics(st.metrics);
    const word = statusWord(st.status, m?.statusWord ?? null);
    if (!word) continue;
    const frozen = word === 'frozen';
    const psi = frozen ? null : (m?.worstPsi ?? null);
    const oor = frozen ? null : (m?.maxOutOfRangePct ?? null);
    rows.push({
      modelId: st.modelId,
      model: st.modelName,
      status: word,
      reason: frozen
        ? st.frozenColumns.length > 0
          ? `Frozen: ${st.frozenColumns.join(', ')}`
          : 'Frozen'
        : shortReason(st.reason),
      worstInput: frozen ? null : (m?.worstPsiColumn ?? null),
      psi,
      psiBand: psiBandFor(psi, legend),
      outOfRangePct: oor,
      outOfRangeBand: outOfRangeBandFor(oor, legend),
      sdRatio: m?.sdRatio ?? null,
      sdBand: sdBandFor(
        m?.sdRatio ?? null,
        m?.warnSd ?? null,
        m?.criticalSd ?? null,
      ),
      warnSd: m?.warnSd ?? null,
      criticalSd: m?.criticalSd ?? null,
      since: m?.statusSince ?? null,
      openMinutes: minutesSince(m?.statusSince ?? null, now),
    });
  }
  return rows.sort(
    (a, b) =>
      WORD_RANK[a.status] - WORD_RANK[b.status] ||
      a.model.localeCompare(b.model),
  );
}

export function buildDigestData(input: {
  workspaceName: string;
  total: number;
  states: DigestStateInput[];
  legend: DigestThresholds;
  changes: DigestChange[];
  at: Date;
}): DigestData {
  const rows = buildDigestRows(input.states, input.legend, input.at);
  let longest: DigestLongest | null = null;
  for (const r of rows) {
    if (r.since === null || r.openMinutes === null) continue;
    if (longest === null || r.openMinutes > longest.minutes) {
      longest = {
        model: r.model,
        status: r.status,
        since: r.since,
        minutes: r.openMinutes,
      };
    }
  }
  return {
    workspaceName: input.workspaceName,
    total: input.total,
    alertCount: rows.filter((r) => r.status === 'alert').length,
    warningCount: rows.filter((r) => r.status === 'warning').length,
    frozenCount: rows.filter((r) => r.status === 'frozen').length,
    offlineCount: rows.filter((r) => r.status === 'offline').length,
    rows,
    legend: input.legend,
    changes: input.changes,
    longest,
  };
}
