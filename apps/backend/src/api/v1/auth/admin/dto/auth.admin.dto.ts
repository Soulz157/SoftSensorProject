import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { createStandardResponseSchema } from '@/lib/dto';

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ActivityLogQuerySchema = PaginationQuerySchema.extend({
  action: z.enum(['LOGIN', 'LOGOUT']).optional(),
  userId: z.string().optional(),
});

export const ActivityLogItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  action: z.enum(['LOGIN', 'LOGOUT']),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.coerce.date(),
  user: z.object({
    id: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string(),
  }),
});

export const UserStatItemSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
  role: z.enum(['USER', 'STAFF', 'ADMIN']),
  createdAt: z.coerce.date(),
  logins7d: z.number().int().nonnegative(),
});

export const ActivityLogResponseSchema = createStandardResponseSchema(
  z.object({
    items: z.array(ActivityLogItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
);

export const UserStatsResponseSchema = createStandardResponseSchema(
  z.object({
    items: z.array(UserStatItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
);

export class PaginationQueryDto extends createZodDto(PaginationQuerySchema) {}

export class ActivityLogQueryDto extends createZodDto(ActivityLogQuerySchema) {}

export class ActivityLogResponseDto extends createZodDto(
  ActivityLogResponseSchema,
) {}

export class UserStatsResponseDto extends createZodDto(
  UserStatsResponseSchema,
) {}
