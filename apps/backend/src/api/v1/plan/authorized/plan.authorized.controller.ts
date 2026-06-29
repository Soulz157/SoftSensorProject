import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlanAuthorizedService } from './plan.authorized.service';
import {
  PlanListResponseDto,
  SubscribeDto,
  SubscriptionResponseDto,
} from './dto/plan.authorized.dto';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';

@ApiBearerAuth()
@ApiTags('Plan')
@Controller('authorized/plan')
@UseGuards(JwtAccessGuard)
export class PlanAuthorizedController {
  constructor(private readonly planService: PlanAuthorizedService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all available plans' })
  @ApiOkResponse({ type: PlanListResponseDto })
  async listPlans() {
    return this.planService.listPlans();
  }

  @Get('/subscription')
  @HttpCode(200)
  @ApiOperation({ summary: "Get current user's active subscription" })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  async mySubscription(@Users() user: Auth.UserPayload) {
    return this.planService.mySubscription(user.id);
  }

  @Post('/subscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Subscribe the current user to a plan by name' })
  async subscribe(@Users() user: Auth.UserPayload, @Body() body: SubscribeDto) {
    return this.planService.subscribe(user.id, body.planName);
  }

  @Post('/downgrade')
  @HttpCode(200)
  @ApiOperation({ summary: 'Downgrade current plan to FREE' })
  async downgrade(@Users() user: Auth.UserPayload) {
    return this.planService.downgrade(user.id);
  }
}
