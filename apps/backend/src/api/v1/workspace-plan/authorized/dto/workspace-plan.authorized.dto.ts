import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkspacePlanStatusEnum = z.enum([
  'normal',
  'warning',
  'alarm',
  'offline',
]);

export const CreateWorkspacePlanSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});

export const UpdateWorkspacePlanSchema = CreateWorkspacePlanSchema.partial();

export const WorkspacePlanQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const DeleteWorkspacePlanSchema = z.object({
  planId: z.string().uuid(),
});

export class CreateWorkspacePlanDto extends createZodDto(
  CreateWorkspacePlanSchema,
) {}
export class UpdateWorkspacePlanDto extends createZodDto(
  UpdateWorkspacePlanSchema,
) {}
export class WorkspacePlanQueryDto extends createZodDto(
  WorkspacePlanQuerySchema,
) {}
export class DeleteWorkspacePlanDto extends createZodDto(
  DeleteWorkspacePlanSchema,
) {}
