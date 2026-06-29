import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelAuthorizedService } from './model.authorized.service';
import {
  AppendLogDto,
  CreateModelDto,
  DeleteModelDto,
  ModelQueryDto,
  UpdateModelDto,
} from './dto/model.authorized.dto';

@Controller('authorized/model')
@UseGuards(JwtAccessGuard)
export class ModelAuthorizedController {
  constructor(private readonly service: ModelAuthorizedService) {}

  @Get('/')
  getModelsController(
    @Query() query: ModelQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getModelsService(query.workspaceId, user.id, user.role);
  }

  @Post('/')
  createModelController(
    @Body() dto: CreateModelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.createModelService(dto, user.id, user.role);
  }

  @Patch('/:modelId')
  updateModelController(
    @Param('modelId') modelId: string,
    @Body() dto: UpdateModelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.updateModelService(modelId, dto, user.id, user.role);
  }

  @Post('/:modelId/log')
  appendLogController(
    @Param('modelId') modelId: string,
    @Body() dto: AppendLogDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.appendLogService(modelId, dto, user.id);
  }

  @Delete('/')
  deleteModelController(
    @Body() dto: DeleteModelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.deleteModelService(dto.modelId, user.id, user.role);
  }
}
