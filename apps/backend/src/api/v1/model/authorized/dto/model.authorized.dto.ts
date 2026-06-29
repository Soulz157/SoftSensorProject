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

// Wizard data-source/tags/processing config persisted to Model.data.config.
// Lenient by design — the canonical shape lives in the client `ModelConfig`
// type; the backend only stores it round-trip.
export const ModelConfigSchema = z
  .object({
    description: z.string().max(2000).optional(),
    dataSource: z.record(z.string(), z.unknown()).nullable().optional(),
    savedSourceId: z.string().optional(),
    selectedTags: z.array(z.string()).optional(),
    timeRange: z.string().optional(),
    customDateRange: z
      .object({ from: z.string(), to: z.string() })
      .nullable()
      .optional(),
    fillStrategies: z
      .record(
        z.string(),
        z.object({
          strategy: z.string(),
          constantValue: z.number().optional(),
        }),
      )
      .optional(),
    selectedMetrics: z.array(z.string()).optional(),
  })
  .passthrough();

export const CreateModelSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  nodeId: z.string().uuid().optional(),
  config: ModelConfigSchema.optional(),
});

export const UpdateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nodeId: z.string().uuid().nullable().optional(),
  deployStatus: DeployStatusEnum.optional(),
  prodStatus: ProdStatusEnum.optional(),
  statusDetail: z.string().max(500).nullable().optional(),
  config: ModelConfigSchema.optional(),
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
