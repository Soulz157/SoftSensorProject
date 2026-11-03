import type { PrismaService } from '@softsensor/prisma';

/**
 * MODEL-SERVE-046. THE RESIDUAL AXIS'S FALLBACK EVIDENCE, for the days before
 * any lab pair has joined.
 *
 * A pair needs `truthLagMinutes` (a day, for a daily lab) to join, so for
 * that long a model whose newest prediction is wildly off the last reported
 * lab value shows it on the Monitoring chart (the "held" deviation) while the
 * health pill, which only read joined pairs, stayed quiet. This is that same
 * comparison, taken where the pill can read it.
 *
 * WHAT IT IS: the largest |prediction - held| over the newest logged
 * prediction request, where `held` is the target's last REPORTED value
 * (`TagObservation`, written by the scheduled fetch). Both are DB reads — no
 * PI call — so the list stays two batched queries for every model.
 *
 * WHAT IT IS NOT: a measured pair. `held` is carried forward by PI between lab
 * samples, so it can be hours old. MODEL-SERVE-009 therefore keeps it out of
 * every metric; this feeds only the status, only while no joined pair exists
 * (`classifyResidualPoints` ignores it the moment one does), and the verdict
 * says `basis: 'held'` so a reader can tell the two apart.
 */
export interface HeldFallback {
  /** Largest |predicted - held| in the newest prediction request. */
  worstAbsResidual: number;
  /** When that prediction was requested. */
  predictedAt: Date;
}

/** `PredictionLog.predictionStats`: running aggregates of a request. */
interface PredictionStats {
  n?: unknown;
  min?: unknown;
  max?: unknown;
}

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** The worst deviation of a request's predictions from `held`, or null when
 *  the stats carry none. min/max bound every prediction in the request, so
 *  the larger of the two distances IS the worst point. */
export function heldDeviationOf(
  predictionStats: unknown,
  held: number | null,
): number | null {
  if (held === null || !finite(held)) return null;
  const stats = predictionStats as PredictionStats | null;
  if (!stats || !finite(stats.n) || stats.n <= 0) return null;
  if (!finite(stats.min) || !finite(stats.max)) return null;
  return Math.max(Math.abs(stats.min - held), Math.abs(stats.max - held));
}

/** A held value older than this no longer describes "the last reported lab". */
export const HELD_MAX_AGE_HOURS = 7 * 24;

/**
 * Fallback evidence for each production version, keyed by MODEL id. Versions
 * with no target tag, no observation, a stale observation or no logged
 * prediction are simply absent.
 */
export async function loadHeldFallbacks(
  prisma: PrismaService,
  versions: ReadonlyArray<{
    id: string;
    modelId: string;
    targetY: string | null;
  }>,
  now: Date = new Date(),
): Promise<Map<string, HeldFallback>> {
  const out = new Map<string, HeldFallback>();
  const tagged = versions.filter(
    (v): v is typeof v & { targetY: string } => v.targetY !== null,
  );
  if (tagged.length === 0) return out;

  const [observations, logs] = await Promise.all([
    prisma.tagObservation.findMany({
      where: {
        OR: tagged.map((v) => ({ modelId: v.modelId, tag: v.targetY })),
      },
      select: { modelId: true, tag: true, lastValue: true, lastSeenAt: true },
    }),
    prisma.predictionLog.findMany({
      where: { modelVersionId: { in: tagged.map((v) => v.id) } },
      // The newest request per version.
      distinct: ['modelVersionId'],
      orderBy: [{ modelVersionId: 'asc' }, { requestedAt: 'desc' }],
      select: {
        modelVersionId: true,
        requestedAt: true,
        predictionStats: true,
      },
    }),
  ]);

  const observationByModel = new Map(
    observations.map((o) => [`${o.modelId}\u0000${o.tag}`, o]),
  );
  const logByVersion = new Map(logs.map((l) => [l.modelVersionId, l]));
  const maxAgeMs = HELD_MAX_AGE_HOURS * 60 * 60 * 1000;

  for (const version of tagged) {
    const observation = observationByModel.get(
      `${version.modelId}\u0000${version.targetY}`,
    );
    const log = logByVersion.get(version.id);
    if (!observation || !log) continue;
    if (
      !observation.lastSeenAt ||
      now.getTime() - observation.lastSeenAt.getTime() > maxAgeMs
    ) {
      continue;
    }
    const worst = heldDeviationOf(log.predictionStats, observation.lastValue);
    if (worst === null) continue;
    out.set(version.modelId, {
      worstAbsResidual: worst,
      predictedAt: log.requestedAt,
    });
  }
  return out;
}
