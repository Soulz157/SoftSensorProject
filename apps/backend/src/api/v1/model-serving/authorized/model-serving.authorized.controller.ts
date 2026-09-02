import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ServingTokenGuard } from '@/guards/serving-token.guard';
import { ModelServingAuthorizedService } from './model-serving.authorized.service';

/**
 * MODEL-SERVE-002. `apps/serving`-facing only — a different caller from
 * every other `authorized/*` controller in this codebase, which are all
 * browser-facing under `JwtAccessGuard`. Prefix deliberately NOT
 * `authorized/model/:modelId` (`ModelVersionAuthorizedController`'s own
 * prefix): `ModelRunScoreAuthorizedController`'s literal `runs` segment
 * already shadows `:modelId` there, and this is a separate caller with a
 * separate guard, so sharing the prefix buys nothing and risks a route
 * collision.
 */
@Controller('authorized/serving')
@UseGuards(ServingTokenGuard)
export class ModelServingAuthorizedController {
  constructor(private readonly service: ModelServingAuthorizedService) {}

  /** T03. The warm set apps/serving loads before answering /readyz. */
  @Get('/production-versions')
  listProductionVersionsController() {
    return this.service.listProductionVersionsService();
  }

  /** T02/T04/T05/T06. Everything apps/serving's loader needs for one
   *  model, in one round trip — mirrors `scoreClaimService`'s own shape
   *  one entity higher (model, not run). */
  @Get('/models/:modelId/descriptor')
  getDescriptorController(@Param('modelId') modelId: string) {
    return this.service.getDescriptorService(modelId);
  }
}
