import { Module } from '@nestjs/common';
import { ArtifactCleanupAdminController } from './admin/artifact-cleanup.admin.controller';
import { ArtifactCleanupAdminService } from './admin/artifact-cleanup.admin.service';

/**
 * DS-LAKE-009B: intermediate-artifact lifecycle and cleanup.
 *
 * Admin-only today (no public/authorized surface) — see
 * ArtifactCleanupAdminService's doc comment for why this is a plain
 * admin-triggered operation rather than a recurring job.
 */
@Module({
  controllers: [ArtifactCleanupAdminController],
  providers: [ArtifactCleanupAdminService],
})
export class ArtifactCleanupModule {}
