import { Module } from '@nestjs/common';
import { ModelDraftAuthorizedController } from './authorized/model-draft.authorized.controller';
import { ModelDraftAuthorizedService } from './authorized/model-draft.authorized.service';

/**
 * `ModelDraft` — wizard-time owner for the Model Creation Flow refactor
 * (MODEL-FLOW-002). Mirrors `DatasetDraftModule`'s shape; unlike that
 * module, no shared job-runner import is needed yet — training runs are
 * owned by `ModelRunModule`, not by this module.
 */
@Module({
  controllers: [ModelDraftAuthorizedController],
  providers: [ModelDraftAuthorizedService],
})
export class ModelDraftModule {}
