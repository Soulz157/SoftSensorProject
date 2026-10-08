import { Module } from '@nestjs/common';
import { ModelDraftCleanupAdminController } from './admin/model-draft-cleanup.admin.controller';
import { ModelDraftCleanupAdminService } from './admin/model-draft-cleanup.admin.service';

/**
 * MODEL-FLOW-011: ModelDraft lifecycle reclaim — the ModelDraft-side twin of
 * ArtifactCleanupModule/DS-LAKE-014.
 *
 * Admin-only surface (no public/authorized route). Also runs as a periodic
 * sweep — see ModelDraftCleanupAdminService's own doc comment and lifecycle
 * hooks (`onModuleInit`/`onApplicationShutdown`) for the scheduler; the
 * admin endpoint keeps working unchanged either way.
 */
@Module({
  controllers: [ModelDraftCleanupAdminController],
  providers: [ModelDraftCleanupAdminService],
})
export class ModelDraftCleanupModule {}
