import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'VIEWER']).default('VIEWER'),
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'VIEWER']),
});

export const GetLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}
export class UpdateMemberRoleDto extends createZodDto(UpdateMemberRoleSchema) {}
export class GetLogsQueryDto extends createZodDto(GetLogsQuerySchema) {}
