import { Module } from '@nestjs/common';
import { ArtifactCleanupAdminController } from './admin/artifact-cleanup.admin.controller';
import { ArtifactCleanupAdminService } from './admin/artifact-cleanup.admin.service';

/**
 * DS-LAKE-009B: intermediate-artifact lifecycle and cleanup.
 *
 * Admin-only surface (no public/authorized route). DS-LAKE-014 additionally
 * runs this as a periodic sweep — see ArtifactCleanupAdminService's own doc
 * comment and lifecycle hooks (`onModuleInit`/`onApplicationShutdown`) for
 * the scheduler; the admin endpoint keeps working unchanged either way.
 */
@Module({
  controllers: [ArtifactCleanupAdminController],
  providers: [ArtifactCleanupAdminService],
})
export class ArtifactCleanupModule {}
