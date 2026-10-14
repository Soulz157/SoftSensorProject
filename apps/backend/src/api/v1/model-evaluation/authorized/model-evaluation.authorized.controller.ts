import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelEvaluationAuthorizedService } from './model-evaluation.authorized.service';
import { CompareModelEvaluationDto } from './dto/model-evaluation.authorized.dto';

/**
 * MODEL-SERVE-032. `authorized/model/:modelId`, the prefix its sibling
 * inference / version controllers share; disambiguated by `evaluation/`.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class ModelEvaluationAuthorizedController {
  constructor(private readonly service: ModelEvaluationAuthorizedService) {}

  /** POST because it carries a body and does real work (a fetch plus a
   *  scoring pass), though it changes nothing. */
  @Post('/evaluation/compare')
  compareController(
    @Param('modelId') modelId: string,
    @Body() dto: CompareModelEvaluationDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.compareService(modelId, dto, user);
  }
}
