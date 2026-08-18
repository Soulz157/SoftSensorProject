import { Module } from '@nestjs/common';
import { DatasetVersionModule } from '../dataset-version/dataset-version.module';
import { DatasetDraftAuthorizedController } from './authorized/dataset-draft.authorized.controller';
import { DatasetDraftAuthorizedService } from './authorized/dataset-draft.authorized.service';

/**
 * `DatasetDraft` — wizard-time owner under the Draft-first architecture
 * (DS-LAKE-005). Imports `DatasetVersionModule` for its exported
 * `PreprocessingJobService` singleton, so a draft-scoped job and a
 * dataset-scoped job share the same runner instance rather than two.
 */
@Module({
  imports: [DatasetVersionModule],
  controllers: [DatasetDraftAuthorizedController],
  providers: [DatasetDraftAuthorizedService],
})
export class DatasetDraftModule {}
