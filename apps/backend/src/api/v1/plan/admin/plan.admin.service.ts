import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import type { AssignPlanDto } from './dto/plan.admin.dto';

@Injectable()
export class PlanAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans() {
    const items = await this.prisma.plan.findMany({
      orderBy: { price: 'asc' },
    });
    return {
      statusCode: 200,
      message: 'Plans fetched successfully',
      type: 'SUCCESS' as const,
      data: items,
    };
  }

  async assignPlan(userId: string, args: AssignPlanDto) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: args.planId },
    });
    if (!plan) {
      throw new AppException({
        statusCode: 404,
        message: 'Plan not found',
        type: 'ERROR',
      });
    }

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + plan.durationMonths);

    const [, subscription] = await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELED' },
      }),
      this.prisma.subscription.create({
        data: {
          userId,
          planId: plan.id,
          status: 'ACTIVE',
          startDate: new Date(),
          endDate,
        },
        include: { plan: true },
      }),
    ]);

    return {
      statusCode: 200,
      message: `Plan changed to ${plan.name}`,
      type: 'SUCCESS' as const,
      data: subscription,
    };
  }
}
