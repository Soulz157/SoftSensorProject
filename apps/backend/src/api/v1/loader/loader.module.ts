import { Module } from '@nestjs/common';
import { LoaderJobService } from './loader-job.service';
import { LOADER_SINK } from './loader.tokens';
import { LogLoaderSink } from './loader-sink.interface';

/**
 * DS-LAKE-011. Registers the runner (`OnModuleInit`'s boot sweep depends on
 * being a provider) and binds `LOADER_SINK` to the default `LogLoaderSink`
 * — swap this one line to `useClass: <RealSink>` when a serving-layer sink
 * exists, without touching `LoaderJobService` or its callers.
 *
 * Exported so `DatasetVersionModule` can re-export it to `DatasetDraftModule`
 * — same reasoning as `PreprocessingJobService`'s own export comment:
 * a draft-scoped Save call and a dataset-scoped status/retry endpoint
 * should share the SAME runner instance, not two.
 */
@Module({
  providers: [
    LoaderJobService,
    { provide: LOADER_SINK, useClass: LogLoaderSink },
  ],
  exports: [LoaderJobService],
})
export class LoaderModule {}
