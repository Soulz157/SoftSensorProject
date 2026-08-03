import { Module } from '@nestjs/common';
import { DatasetAuthorizedController } from './authorized/dataset.authorized.controller';
import { DatasetAuthorizedService } from './authorized/dataset.authorized.service';
import { DatasetVersionAuthorizedController } from './authorized/dataset-version.authorized.controller';
import { DatasetVersionAuthorizedService } from './authorized/dataset-version.authorized.service';
import { PreprocessingJobService } from './authorized/preprocessing-job.service';

@Module({
  controllers: [
    DatasetAuthorizedController,
    DatasetVersionAuthorizedController,
  ],
  providers: [
    DatasetAuthorizedService,
    DatasetVersionAuthorizedService,
    // Registering the runner is what makes Nest call its OnModuleInit /
    // OnApplicationShutdown hooks — the boot sweep that rescues jobs left
    // RUNNING by a hard kill depends on it being a provider, not a helper.
    PreprocessingJobService,
  ],
})
export class DatasetModule {}
