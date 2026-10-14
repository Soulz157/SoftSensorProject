/**
 * MODEL-SERVE-032. Pure shaping for the Evaluation page's compare read:
 * no I/O, no DI. The service fetches; this decides what a row means.
 */

export type FrameCell = {
  value: number | null;
  status: 'Good' | 'Bad' | 'Questionable';
};

export type FrameRow = {
  timestamp: string;
  usable: boolean;
  cells: Record<string, FrameCell>;
};

export type ComparePoint = {
  /** UTC instant, ISO `Z`. */
  t: string;
  /** null when the row was not scored; `skippedReason` then says why. */
  predicted: number | null;
  skippedReason: string | null;
};

export type RecordedPoint = {
  timestamp: string;
  value: number | null;
  good: boolean;
};

export const MAX_COMPARE_DAYS = 31;
export const MAX_COMPARE_ROWS = 2000;
export const PREDICT_CHUNK = 200;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** '1m' | '30s' | '2h' | '1d' -> ms; null for anything else, never a guess. */
export function intervalToMs(interval: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd])$/i.exec(interval.trim());
  if (!m) return null;
  const ms = Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Rows a [from, to) range implies at a cadence; null if the cadence is
 *  unparseable. Same arithmetic python uses for its own pre-fetch cap. */
export function expectedRows(
  from: Date,
  to: Date,
  interval: string,
): number | null {
  const ms = intervalToMs(interval);
  if (ms === null) return null;
  return Math.floor((to.getTime() - from.getTime()) / ms);
}

/**
 * Why a row was not scored: the non-Good FEATURE columns, named, capped at 3
 * like the live driver's own toast so one broken source stays readable.
 */
export function skipReason(
  row: FrameRow,
  featureColumns: readonly string[],
): string {
  const bad = featureColumns.filter(
    (c) => (row.cells[c]?.status ?? 'Bad') !== 'Good',
  );
  const named = bad.slice(0, 3).join(', ');
  return `Input not usable — ${named}${
    bad.length > 3 ? ` +${bad.length - 3} more` : ''
  } did not report Good values.`;
}

/** The pre-scale feature row the serving process expects, from a usable row.
 *  Throws if a Good cell has no value: that is a contract break, not data. */
export function featureRow(
  row: FrameRow,
  featureColumns: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of featureColumns) {
    const v = row.cells[c]?.value;
    if (v === null || v === undefined) {
      throw new Error(`Usable row ${row.timestamp} has no value for ${c}.`);
    }
    out[c] = v;
  }
  return out;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Align serving's predictions (one per USABLE row, in order) back onto the
 * full row grid. A length mismatch is a hard error: pairing predictions to
 * the wrong timestamps would be silent and plausible.
 */
export function assemblePoints(
  rows: readonly FrameRow[],
  featureColumns: readonly string[],
  predictions: readonly number[],
): ComparePoint[] {
  const usableCount = rows.filter((r) => r.usable).length;
  if (predictions.length !== usableCount) {
    throw new Error(
      `Serving returned ${predictions.length} predictions for ${usableCount} usable rows.`,
    );
  }
  let next = 0;
  return rows.map((row) => {
    if (!row.usable) {
      return {
        t: row.timestamp,
        predicted: null,
        skippedReason: skipReason(row, featureColumns),
      };
    }
    const predicted = predictions[next++];
    if (!Number.isFinite(predicted)) {
      return {
        t: row.timestamp,
        predicted: null,
        skippedReason: 'The model returned a non-finite value.',
      };
    }
    return { t: row.timestamp, predicted, skippedReason: null };
  });
}

/** Column-oriented X series aligned to the row grid (null = Bad / absent),
 *  so the payload carries the timestamps once, not once per tag. */
export function xSeries(
  rows: readonly FrameRow[],
  tags: readonly string[],
): Record<string, Array<number | null>> {
  const out: Record<string, Array<number | null>> = {};
  for (const tag of tags) {
    out[tag] = rows.map((r) =>
      r.cells[tag]?.status === 'Bad' ? null : (r.cells[tag]?.value ?? null),
    );
  }
  return out;
}

/** Lab events the page may chart: Good, numeric, inside [from, to). A held
 *  or Bad event is never a measurement. */
export function labEvents(
  points: readonly RecordedPoint[],
  from: Date,
  to: Date,
): Array<{ t: string; value: number }> {
  const out: Array<{ t: string; value: number }> = [];
  for (const p of points) {
    if (!p.good || p.value === null) continue;
    const at = Date.parse(p.timestamp);
    if (!Number.isFinite(at) || at < from.getTime() || at >= to.getTime()) {
      continue;
    }
    out.push({ t: p.timestamp, value: p.value });
  }
  return out;
}
