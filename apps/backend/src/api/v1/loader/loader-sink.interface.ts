import { Injectable, Logger } from '@nestjs/common';

/**
 * DS-LAKE-011-T02: what a serving-layer sink must implement to receive a
 * committed DatasetVersion. One interface, one default implementation —
 * a TimescaleDB sink can be added later by implementing this same shape
 * and swapping the provider `LoaderJobService` is given, without touching
 * the enqueue path (`LoaderJobService.enqueue`) or the retry/boot-sweep
 * machinery at all.
 *
 * `load` receives ONLY identifiers, never a materialized frame — MinIO
 * remains the source of truth (AC3); a real sink resolves the artifact's
 * object key itself if and when it needs the data, the same way every
 * other Python-side consumer does. This seam does not read or pass rows.
 */
export interface LoaderSinkPayload {
  datasetId: string;
  versionId: string;
}

export interface LoaderSink {
  load(payload: LoaderSinkPayload): Promise<void>;
}

/**
 * The single default implementation this seam ships with today. Logs the
 * hand-off and returns — deliberately NOT a silent no-op (a sink that does
 * nothing observable would make `LoaderJob.status` a lie about what
 * happened) and deliberately NOT a real serving-layer destination: there is
 * no TimescaleDB in this repo (CLAUDE.md §3, deferred per this feature's
 * own scope decision — see `deferred[]` in feature_list.preprocessing.json,
 * DS-LAKE-011). Exists so the seam (enqueue -> run -> retry -> boot sweep)
 * is exercised against a REAL implementation of `LoaderSink`, not a mock
 * standing in for one that doesn't exist yet.
 */
@Injectable()
export class LogLoaderSink implements LoaderSink {
  private readonly logger = new Logger(LogLoaderSink.name);

  async load(payload: LoaderSinkPayload): Promise<void> {
    this.logger.log(
      `Loader seam: dataset ${payload.datasetId} version ${payload.versionId} ` +
        'ready for a serving-layer sink (none configured — logging only).',
    );
  }
}
