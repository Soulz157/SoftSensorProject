import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateDatasetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  workspaceId: z.string().uuid(),
  sourceIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  pipelineConfig: z.record(z.string(), z.unknown()).default({}),
  fileUrl: z.string().nullish(),
  rowCount: z.number().int().nonnegative().default(0),
  missingPct: z.number().min(0).default(0),
});

export const UpdateDatasetSchema = CreateDatasetSchema.partial().omit({
  workspaceId: true,
});

export class CreateDatasetDto extends createZodDto(CreateDatasetSchema) {}
export class UpdateDatasetDto extends createZodDto(UpdateDatasetSchema) {}
