import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { createStandardResponseSchema } from '@/lib/dto';

export const PlanItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().nullable(),
  maxWorkspaces: z.number().int(),
  durationMonths: z.number().int(),
});

export const SubscriptionItemSchema = z.object({
  id: z.string(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELED', 'TRIALING']),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  plan: PlanItemSchema,
});

export const SubscribeSchema = z.object({
  planName: z.string().min(1),
});

export const PlanListResponseSchema = createStandardResponseSchema(
  z.array(PlanItemSchema),
);

export const SubscriptionResponseSchema = createStandardResponseSchema(
  SubscriptionItemSchema.nullable(),
);

export class SubscribeDto extends createZodDto(SubscribeSchema) {}
export class PlanListResponseDto extends createZodDto(PlanListResponseSchema) {}
export class SubscriptionResponseDto extends createZodDto(
  SubscriptionResponseSchema,
) {}
