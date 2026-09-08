import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelInputSchemaAuthorizedService } from './model-input-schema.authorized.service';

/**
 * `authorized/model/:modelId`, matching `model-version`/`prediction-log`'s
 * own prefix — same owner entity, same JWT caller. A read, not a mutation,
 * so it lives beside `ModelVersionAuthorizedController` in the same module
 * (both own `ModelVersion`) rather than reusing that controller's class:
 * `ModelVersionAuthorizedService.assertModelAccess` is documented as
 * editor-level ("promoting or rolling back what answers live traffic is
 * not a read") and this is a read.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class ModelInputSchemaAuthorizedController {
  constructor(private readonly service: ModelInputSchemaAuthorizedService) {}

  @Get('/input-schema')
  getInputSchemaController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getInputSchemaService(modelId, user);
  }
}
