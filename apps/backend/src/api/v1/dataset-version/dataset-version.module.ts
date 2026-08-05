import { Module } from '@nestjs/common';
import { DatasetVersionAuthorizedController } from './authorized/dataset-version.authorized.controller';
import { DatasetVersionAuthorizedService } from './authorized/dataset-version.authorized.service';
import { PreprocessingJobService } from './authorized/preprocessing-job.service';

/**
 * Versions, stored rows, preview, and the cleaning-job runner.
 *
 * Split out of DatasetModule: the Dataset CRUD half and this half share no
 * code, only the `authorized/dataset` route prefix. That prefix is deliberately
 * kept identical here, so the split is invisible to every client.
 */
@Module({
  controllers: [DatasetVersionAuthorizedController],
  providers: [
    DatasetVersionAuthorizedService,
    // Registering the runner is what makes Nest call its OnModuleInit /
    // OnApplicationShutdown hooks — the boot sweep that rescues jobs left
    // RUNNING by a hard kill depends on it being a provider, not a helper.
    PreprocessingJobService,
  ],
  // Exported so DatasetDraftModule can inject the SAME instance rather than
  // registering its own copy. Two instances would each run their own boot
  // sweep and hold a disjoint `running` map — harmless for the sweep, but
  // architecturally the wrong shape for what is one job runner, not two.
  exports: [PreprocessingJobService],
})
export class DatasetVersionModule {}
