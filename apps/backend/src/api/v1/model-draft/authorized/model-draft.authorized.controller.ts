import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelDraftAuthorizedService } from './model-draft.authorized.service';
import {
  CreateModelDraftDto,
  ListModelDraftQueryDto,
  PatchModelDraftDto,
  SaveModelDraftDto,
} from './dto/model-draft.authorized.dto';

/**
 * `ModelDraft` — the Model Creation wizard's server-side owner while no
 * `Model` row exists yet (MODEL-FLOW-002).
 *
 * Deliberately its own top-level route (`authorized/model-drafts`), not
 * nested under `authorized/model` like the run routes next door: a draft is
 * not a model and has no model id to key a nested route on — same
 * reasoning `DatasetDraftAuthorizedController` states for itself.
 *
 * Thin by design (CLAUDE.md §5) — every method delegates.
 */
@ApiBearerAuth()
@ApiTags('Model Draft')
@Controller('authorized/model-drafts')
@UseGuards(JwtAccessGuard)
export class ModelDraftAuthorizedController {
  constructor(private readonly service: ModelDraftAuthorizedService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start a Model Creation draft',
    description:
      'Creates NO Model row. Training runs against this draft until Save ' +
      'Model promotes it.',
  })
  async createDraftController(
    @Users() user: Auth.UserPayload,
    @Body() body: CreateModelDraftDto,
  ) {
    return this.service.createDraftService(user, body);
  }

  /**
   * Declared BEFORE `@Get('/:id')` on purpose — Nest matches routes in
   * declaration order, and a bare GET would otherwise never be reached.
   */
  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'List Model Creation drafts',
    description:
      'Scoped to workspaces the caller can reach, newest-touched first. ' +
      'Optionally filtered by workspace and status — the models list asks ' +
      'for ACTIVE to offer an unfinished wizard back to the user.',
  })
  async listDraftsController(
    @Users() user: Auth.UserPayload,
    @Query() query: ListModelDraftQueryDto,
  ) {
    return this.service.listDraftsService(user, query);
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch a Model Creation draft' })
  async getDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.getDraftService(user, id);
  }

  @Patch('/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update a Model Creation draft configuration',
    description:
      'Whichever fields are provided are updated; the rest are left as ' +
      'they are. Refuses (409) once the draft has been saved as a Model.',
  })
  async patchDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: PatchModelDraftDto,
  ) {
    return this.service.patchDraftService(user, id, body);
  }

  @Post('/:id/abandon')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Abandon a draft',
    description:
      'Marks the draft ABANDONED. Its training runs are left in place — ' +
      'nothing is deleted.',
  })
  async abandonDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.abandonDraftService(user, id);
  }

  /**
   * MODEL-FLOW-007. The ONLY route allowed to create the final persistent
   * `Model` — see `saveDraftService`'s own doc comment. Adopts the draft's
   * winning run by pointer and flips the draft to SAVED; refuses (409) a
   * draft already saved.
   */
  @Post('/:id/save')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Save Model — the one persistence boundary',
    description:
      "Creates the persistent Model, adopting the draft's winning " +
      'training run by pointer. Config (algorithm/hyperparameters/target/' +
      'split) is derived server-side from that run, not trusted from the ' +
      'request body. Refuses (409) a draft already saved.',
  })
  async saveDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: SaveModelDraftDto,
  ) {
    return this.service.saveDraftService(user, id, body);
  }
}
