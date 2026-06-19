import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DeployStatusEnum = z.enum([
  'stopped',
  'running',
  'error',
  'initializing',
]);
export const ProdStatusEnum = z.enum([
  'normal',
  'warning',
  'alert',
  'offline',
  'frozen',
]);

export const CreateModelSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  nodeId: z.string().uuid().optional(),
});

export const UpdateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nodeId: z.string().uuid().nullable().optional(),
  deployStatus: DeployStatusEnum.optional(),
  prodStatus: ProdStatusEnum.optional(),
  statusDetail: z.string().max(500).nullable().optional(),
});

export const AppendLogSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().min(1).max(500),
});

export const ModelQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const DeleteModelSchema = z.object({
  modelId: z.string().uuid(),
});

export class CreateModelDto extends createZodDto(CreateModelSchema) {}
export class UpdateModelDto extends createZodDto(UpdateModelSchema) {}
export class AppendLogDto extends createZodDto(AppendLogSchema) {}
export class ModelQueryDto extends createZodDto(ModelQuerySchema) {}
export class DeleteModelDto extends createZodDto(DeleteModelSchema) {}
