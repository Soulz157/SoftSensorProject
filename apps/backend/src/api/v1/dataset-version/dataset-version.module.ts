import { Module } from '@nestjs/common';
import { DatasetVersionAuthorizedController } from './authorized/dataset-version.authorized.controller';
import { DatasetVersionAuthorizedService } from './authorized/dataset-version.authorized.service';
import { PreprocessingJobService } from './authorized/preprocessing-job.service';
import { LoaderModule } from '../loader/loader.module';

/**
 * Versions, stored rows, preview, and the cleaning-job runner.
 *
 * Split out of DatasetModule: the Dataset CRUD half and this half share no
 * code, only the `authorized/dataset` route prefix. That prefix is deliberately
 * kept identical here, so the split is invisible to every client.
 */
@Module({
  imports: [LoaderModule],
  controllers: [DatasetVersionAuthorizedController],
  providers: [
    DatasetVersionAuthorizedService,
    // Registering the runner is what makes Nest call its OnModuleInit /
    // OnApplicationShutdown hooks — the boot sweep that rescues jobs left
    // RUNNING by a hard kill depends on it being a provider, not a helper.
    PreprocessingJobService,
  ],
  // Exported so DatasetDraftModule can inject the SAME instance(s) rather
  // than registering its own copy. Two instances would each run their own
  // boot sweep — harmless for the sweep itself, but architecturally the
  // wrong shape for what is one job runner, not two. LoaderJobService
  // (DS-LAKE-011) is re-exported here for the identical reason: Save
  // Dataset (DatasetDraftModule) enqueues, this module's own status/retry
  // endpoints read — one runner instance, not two.
  //
  // BUGFIX (found + fixed same session as DS-LAKE-005B-D-T01): re-exporting
  // the bare `LoaderJobService` token here threw `UnknownExportException` at
  // boot — Nest's own `Module.validateExportedProvider` (injector/module.js)
  // only allows re-exporting a token that is EITHER this module's own
  // provider (true for `PreprocessingJobService`, listed above) OR an
  // imported MODULE class itself (`imports.includes(token)`, checked against
  // module metatypes, not the providers those modules export). A provider
  // that only exists via an imported module — `LoaderJobService` was never
  // in THIS module's own `providers` — cannot be cherry-picked that way; the
  // whole owning module has to be re-exported instead. Re-exporting
  // `LoaderModule` grants every consumer of `DatasetVersionModule`
  // (currently `DatasetDraftModule`) the same transitive access to
  // `LoaderJobService` that re-exporting the bare token was meant to give,
  // without the invalid re-export.
  exports: [PreprocessingJobService, LoaderModule],
})
export class DatasetVersionModule {}
