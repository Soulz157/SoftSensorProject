import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';

@Injectable()
export class PlanAuthorizedService {
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

  async mySubscription(userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { not: 'CANCELED' },
      },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      statusCode: 200,
      message: 'Subscription fetched successfully',
      type: 'SUCCESS' as const,
      data: subscription ?? null,
    };
  }

  async subscribe(userId: string, planName: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { name: planName },
    });
    if (!plan) {
      throw new AppException({
        statusCode: 404,
        message: `Plan '${planName}' not found`,
        type: 'ERROR',
      });
    }

    const current = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (current?.plan.name === planName) {
      throw new AppException({
        statusCode: 400,
        message: `Already subscribed to the ${planName} plan`,
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
      message: `Subscribed to the ${planName} plan`,
      type: 'SUCCESS' as const,
      data: subscription,
    };
  }

  async downgrade(userId: string) {
    const freePlan = await this.prisma.plan.findUnique({
      where: { name: 'FREE' },
    });
    if (!freePlan) {
      throw new AppException({
        statusCode: 400,
        message: 'FREE plan not found',
        type: 'ERROR',
      });
    }

    const current = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    if (current?.plan.name === 'FREE') {
      throw new AppException({
        statusCode: 400,
        message: 'Already on FREE plan',
        type: 'ERROR',
      });
    }

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + freePlan.durationMonths);

    const [, subscription] = await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELED' },
      }),
      this.prisma.subscription.create({
        data: {
          userId,
          planId: freePlan.id,
          status: 'ACTIVE',
          startDate: new Date(),
          endDate,
        },
        include: { plan: true },
      }),
    ]);

    return {
      statusCode: 200,
      message: 'Downgraded to FREE plan',
      type: 'SUCCESS' as const,
      data: subscription,
    };
  }
}
