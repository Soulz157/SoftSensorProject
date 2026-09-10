import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { METRIC_REGISTRY } from '@/lib/metric-registry';

/**
 * MODEL-SERVE-006-T08 (Pass B). No modelId, no service, no DB read — this
 * is static registry metadata (which metric NAMES exist and whether each
 * is backfillable in principle), not a per-model computation. Its own
 * tiny module rather than folded into model-version's `authorized/model/
 * :modelId` prefix, which this route has no reason to be nested under.
 */
@Controller('authorized/metrics')
@UseGuards(JwtAccessGuard)
export class MetricRegistryAuthorizedController {
  @Get('/registry')
  getRegistryController() {
    return {
      statusCode: 200,
      message: 'Metric registry',
      type: 'SUCCESS' as const,
      data: METRIC_REGISTRY,
    };
  }
}
