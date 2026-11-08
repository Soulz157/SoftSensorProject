/**
 * Pure derivations for the Data Intake analytics page (no IO, no Prisma).
 *
 * Three questions, answered from stored state:
 *  - what is arriving, and how often is it Bad  → `fillBuckets`
 *  - which live tags are Good / Bad / Questionable → `rollupTags`
 *  - how many bytes do a workspace's datasets hold → `rollupStorage`
 *
 * `missingPct` is already a 0–100 percentage (`object_store.missing_pct`), so
 * nothing here rescales it.
 */

export const INTAKE_RANGES = ['24h', '7d', '1m', '1y'] as const;
export type IntakeRange = (typeof INTAKE_RANGES)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const RANGE_SPEC: Record<IntakeRange, { spanMs: number; bucketMs: number }> = {
  '24h': { spanMs: DAY_MS, bucketMs: HOUR_MS },
  '7d': { spanMs: 7 * DAY_MS, bucketMs: 6 * HOUR_MS },
  '1m': { spanMs: 30 * DAY_MS, bucketMs: DAY_MS },
  '1y': { spanMs: 365 * DAY_MS, bucketMs: 7 * DAY_MS },
};

export interface IntakeWindow {
  from: Date;
  to: Date;
  bucketMs: number;
}

/** The queried span and its bucket size. `from` is aligned down to a bucket
 *  boundary (epoch-aligned, the same alignment the SQL uses) so the first
 *  bucket is whole. */
export function rangeWindow(range: IntakeRange, now: Date): IntakeWindow {
  const { spanMs, bucketMs } = RANGE_SPEC[range];
  const rawFrom = now.getTime() - spanMs;
  const from = new Date(Math.floor(rawFrom / bucketMs) * bucketMs);
  return { from, to: now, bucketMs };
}

/** One SQL-aggregated bucket row. `bucket` is epoch seconds (floored to the
 *  bucket size in SQL); `badWeighted` is `SUM(missingPct * inputRows)`. */
export interface ScheduledBucketRow {
  bucket: number;
  workspaceId: string;
  rows: number;
  badWeighted: number;
}

export interface PredictBucketRow {
  bucket: number;
  workspaceId: string;
  rows: number;
}

export interface IngestionPoint {
  bucketStart: string;
  scheduledRows: number;
  predictRows: number;
  /** Share of scheduled input cells that were not Good, 0–100. Null when the
   *  bucket carried no scheduled rows — "unknown", never 0. */
  badCellPct: number | null;
}

/** Gap-filled series across every bucket in the window, summed over the
 *  workspaces present in the rows. */
export function fillBuckets(
  scheduled: ScheduledBucketRow[],
  predict: PredictBucketRow[],
  window: IntakeWindow,
): IngestionPoint[] {
  const acc = new Map<
    number,
    { scheduled: number; predict: number; bad: number }
  >();
  const slot = (bucketSec: number) => {
    const key = bucketSec * 1000;
    let s = acc.get(key);
    if (!s) {
      s = { scheduled: 0, predict: 0, bad: 0 };
      acc.set(key, s);
    }
    return s;
  };
  for (const r of scheduled) {
    const s = slot(r.bucket);
    s.scheduled += r.rows;
    s.bad += r.badWeighted;
  }
  for (const r of predict) slot(r.bucket).predict += r.rows;

  const points: IngestionPoint[] = [];
  for (
    let t = window.from.getTime();
    t <= window.to.getTime();
    t += window.bucketMs
  ) {
    const s = acc.get(t);
    points.push({
      bucketStart: new Date(t).toISOString(),
      scheduledRows: s?.scheduled ?? 0,
      predictRows: s?.predict ?? 0,
      badCellPct: s && s.scheduled > 0 ? round2(s.bad / s.scheduled) : null,
    });
  }
  return points;
}

/** Rows ingested per workspace over the window (scheduled + predict). */
export function rowsByWorkspace(
  scheduled: ScheduledBucketRow[],
  predict: PredictBucketRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of [...scheduled, ...predict]) {
    out.set(r.workspaceId, (out.get(r.workspaceId) ?? 0) + r.rows);
  }
  return out;
}

/** Overall Bad-cell % across scheduled rows, null when there are none. */
export function overallBadPct(scheduled: ScheduledBucketRow[]): number | null {
  let rows = 0;
  let bad = 0;
  for (const r of scheduled) {
    rows += r.rows;
    bad += r.badWeighted;
  }
  return rows > 0 ? round2(bad / rows) : null;
}

// ---------------------------------------------------------------------------
// Live tag quality
// ---------------------------------------------------------------------------

/** `TagObservation.lastStatus`: 0 Good, 1 Bad, 2 Questionable. */
export type TagQuality =
  | 'good'
  | 'bad'
  | 'questionable'
  | 'noReading'
  | 'notLive';

export interface TagObservationInput {
  modelId: string;
  modelName: string;
  tag: string;
  lastValue: number | null;
  lastStatus: number | null;
  lastSeenAt: Date | null;
  lastChangedAt: Date | null;
  /** The model's schedule is on: `enabled || livePredictEnabled`. */
  scheduleLive: boolean;
  cadenceMinutes: number;
}

export interface TagRow {
  modelId: string;
  modelName: string;
  tag: string;
  quality: TagQuality;
  lastValue: number | null;
  lastSeenAt: string | null;
  /** Minutes the value has been held flat; a hint, not the staleness test. */
  heldMinutes: number | null;
}

export interface TagCounts {
  good: number;
  bad: number;
  questionable: number;
  noReading: number;
  notLive: number;
}

/** An observation older than this many cadences is no longer live input. */
export const STALE_CADENCES = 3;

const QUALITY_RANK: Record<TagQuality, number> = {
  bad: 0,
  questionable: 1,
  noReading: 2,
  notLive: 3,
  good: 4,
};

export function emptyTagCounts(): TagCounts {
  return { good: 0, bad: 0, questionable: 0, noReading: 0, notLive: 0 };
}

export function addTagCounts(a: TagCounts, b: TagCounts): TagCounts {
  return {
    good: a.good + b.good,
    bad: a.bad + b.bad,
    questionable: a.questionable + b.questionable,
    noReading: a.noReading + b.noReading,
    notLive: a.notLive + b.notLive,
  };
}

/** `TagObservation` is the LAST state per (model, tag) and is never cleared,
 *  so a row from a switched-off schedule still says "Good". Such a row is
 *  `notLive`, never green. */
export function classifyTag(obs: TagObservationInput, now: Date): TagQuality {
  if (!obs.scheduleLive) return 'notLive';
  if (!obs.lastSeenAt) return 'noReading';
  const cadenceMs = Math.max(1, obs.cadenceMinutes) * 60_000;
  if (now.getTime() - obs.lastSeenAt.getTime() > STALE_CADENCES * cadenceMs) {
    return 'notLive';
  }
  switch (obs.lastStatus) {
    case 0:
      return 'good';
    case 1:
      return 'bad';
    case 2:
      return 'questionable';
    default:
      return 'noReading';
  }
}

function heldMinutes(obs: TagObservationInput): number | null {
  if (!obs.lastSeenAt || !obs.lastChangedAt) return null;
  return Math.max(
    0,
    (obs.lastSeenAt.getTime() - obs.lastChangedAt.getTime()) / 60_000,
  );
}

/** One workspace's observations → per-(model, tag) rows plus DISTINCT-tag
 *  counts. A tag read by several models counts once, by its best
 *  observation: live beats not-live, then the newest `lastSeenAt`. */
export function rollupTags(
  observations: TagObservationInput[],
  now: Date,
): { rows: TagRow[]; counts: TagCounts } {
  const rows: TagRow[] = observations.map((o) => ({
    modelId: o.modelId,
    modelName: o.modelName,
    tag: o.tag,
    quality: classifyTag(o, now),
    lastValue: o.lastValue,
    lastSeenAt: o.lastSeenAt ? o.lastSeenAt.toISOString() : null,
    heldMinutes: heldMinutes(o),
  }));

  const best = new Map<string, { quality: TagQuality; seen: number }>();
  rows.forEach((row, i) => {
    const seen = observations[i].lastSeenAt?.getTime() ?? 0;
    const prev = best.get(row.tag);
    const better =
      !prev ||
      (prev.quality === 'notLive' && row.quality !== 'notLive') ||
      ((prev.quality === 'notLive') === (row.quality === 'notLive') &&
        seen > prev.seen);
    if (better) best.set(row.tag, { quality: row.quality, seen });
  });

  const counts = emptyTagCounts();
  for (const { quality } of best.values()) counts[quality] += 1;

  rows.sort(
    (a, b) =>
      QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality] ||
      a.tag.localeCompare(b.tag) ||
      a.modelName.localeCompare(b.modelName),
  );
  return { rows, counts };
}

// ---------------------------------------------------------------------------
// Dataset storage
// ---------------------------------------------------------------------------

export type DraftStatusInput = 'ACTIVE' | 'SAVED' | 'ABANDONED';

/** An artifact whose object has not been reclaimed (`objectReclaimedAt` is
 *  null), i.e. whose bytes still exist. */
export interface ArtifactInput {
  objectKey: string;
  sizeBytes: bigint | number;
  datasetId: string | null;
  draftId: string | null;
  draftStatus: DraftStatusInput | null;
}

export interface StorageRollup {
  savedBytes: number;
  activeDraftBytes: number;
  /** Draft artifacts of SAVED/ABANDONED drafts the cleanup has not reclaimed. */
  cleanupBytes: number;
  totalBytes: number;
  byDataset: Map<string, number>;
}

type StorageClass = 'saved' | 'active' | 'cleanup';
const CLASS_PRIORITY: Record<StorageClass, number> = {
  saved: 0,
  active: 1,
  cleanup: 2,
};

function storageClass(a: ArtifactInput): StorageClass {
  if (a.datasetId) return 'saved';
  return a.draftStatus === 'ACTIVE' ? 'active' : 'cleanup';
}

/** Deduped by `objectKey`: FINAL promotion (and datasets saved before
 *  2026-08-26) share one object between a draft and a dataset, so the bytes
 *  count once, as saved when a dataset owns them. */
export function rollupStorage(artifacts: ArtifactInput[]): StorageRollup {
  const byKey = new Map<
    string,
    { bytes: number; cls: StorageClass; datasetId: string | null }
  >();
  for (const a of artifacts) {
    const cls = storageClass(a);
    const prev = byKey.get(a.objectKey);
    if (!prev || CLASS_PRIORITY[cls] < CLASS_PRIORITY[prev.cls]) {
      byKey.set(a.objectKey, {
        bytes: Number(a.sizeBytes),
        cls,
        datasetId: a.datasetId,
      });
    }
  }

  const out: StorageRollup = {
    savedBytes: 0,
    activeDraftBytes: 0,
    cleanupBytes: 0,
    totalBytes: 0,
    byDataset: new Map(),
  };
  for (const { bytes, cls, datasetId } of byKey.values()) {
    out.totalBytes += bytes;
    if (cls === 'saved') {
      out.savedBytes += bytes;
      if (datasetId) {
        out.byDataset.set(
          datasetId,
          (out.byDataset.get(datasetId) ?? 0) + bytes,
        );
      }
    } else if (cls === 'active') out.activeDraftBytes += bytes;
    else out.cleanupBytes += bytes;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
