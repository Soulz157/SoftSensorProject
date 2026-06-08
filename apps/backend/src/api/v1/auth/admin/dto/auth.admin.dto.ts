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
  role: z.enum(['USER', 'ADMIN']),
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

// ─── Admin User Management ────────────────────────────────────────────────────

export const AdminUserQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  status: z.enum(['active', 'blocked', 'deleted']).optional(),
});

export const UpdateUserRoleSchema = z.object({
  role: z.enum(['USER', 'ADMIN']),
});

export const AdminUserItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  company: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN']),
  createdAt: z.coerce.date(),
  blockedAt: z.coerce.date().nullable(),
  deletedAt: z.coerce.date().nullable(),
  _count: z.object({ workspaces: z.number().int() }),
});

export const AdminUserListResponseSchema = createStandardResponseSchema(
  z.object({
    items: z.array(AdminUserItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
);

export class AdminUserQueryDto extends createZodDto(AdminUserQuerySchema) {}
export class UpdateUserRoleDto extends createZodDto(UpdateUserRoleSchema) {}
export class AdminUserListResponseDto extends createZodDto(
  AdminUserListResponseSchema,
) {}
