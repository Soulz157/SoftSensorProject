import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelInputStatusAuthorizedService } from './model-input-status.authorized.service';

/**
 * MODEL-SERVE-001-T15. Beside `/input-schema` on the same prefix, but a
 * SEPARATE route deliberately: that one is a static schema read that must
 * never fail the tab, this one makes a live PI call. Keeping them apart is
 * what lets PI being unreachable degrade a single column instead of
 * blanking the whole feature list — see the service's own doc comment.
 *
 * Takes no time range: this is a "right now" snapshot read, unlike the
 * sibling `/drift` and `/psi` reads which pool a [from, to] window.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class ModelInputStatusAuthorizedController {
  constructor(private readonly service: ModelInputStatusAuthorizedService) {}

  @Get('/input-status')
  getInputStatusController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getInputStatusService(modelId, user);
  }
}
