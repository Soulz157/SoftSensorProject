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

export const EdgeItemSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export const ReplaceEdgesSchema = z.object({
  edges: z.array(EdgeItemSchema),
});

export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}
export class UpdateMemberRoleDto extends createZodDto(UpdateMemberRoleSchema) {}
export class GetLogsQueryDto extends createZodDto(GetLogsQuerySchema) {}
export class EdgeItemDto extends createZodDto(EdgeItemSchema) {}
export class ReplaceEdgesDto extends createZodDto(ReplaceEdgesSchema) {}
