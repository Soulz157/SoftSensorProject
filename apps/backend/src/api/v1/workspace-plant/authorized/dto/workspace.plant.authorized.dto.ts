import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkspacePlantStatusEnum = z.enum([
  'normal',
  'warning',
  'alarm',
  'offline',
]);

export const CreateWorkspacePlantSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});

export const UpdateWorkspacePlantSchema = CreateWorkspacePlantSchema.partial();

export const WorkspacePlantQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const DeleteWorkspacePlantSchema = z.object({
  plantId: z.string().uuid(),
});

export class CreateWorkspacePlantDto extends createZodDto(
  CreateWorkspacePlantSchema,
) {}
export class UpdateWorkspacePlantDto extends createZodDto(
  UpdateWorkspacePlantSchema,
) {}
export class WorkspacePlantQueryDto extends createZodDto(
  WorkspacePlantQuerySchema,
) {}
export class DeleteWorkspacePlantDto extends createZodDto(
  DeleteWorkspacePlantSchema,
) {}
