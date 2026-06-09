import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const NodeTypeEnum = z.enum(['machine', 'sensor', 'controller']);
export const NodeStatusEnum = z.enum(['normal', 'warning', 'alarm', 'offline']);

export const NodeDataSchema = z.object({
  name: z.string().min(1),
  type: NodeTypeEnum,
  status: NodeStatusEnum,
  icon: z.string().optional(),
  x: z.number(),
  y: z.number(),
});

export const CreateNodeSchema = z.object({
  workspaceId: z.string().uuid(),
  planId: z.string().uuid(),
  data: NodeDataSchema,
});

export const UpdateNodeSchema = z.object({
  data: NodeDataSchema.partial(),
});

export const NodeQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  planId: z.string().uuid().optional(),
});

export const DeleteNodeSchema = z.object({
  nodeId: z.string().min(1),
});

export class CreateNodeDto extends createZodDto(CreateNodeSchema) {}
export class UpdateNodeDto extends createZodDto(UpdateNodeSchema) {}
export class NodeQueryDto extends createZodDto(NodeQuerySchema) {}
export class DeleteNodeDto extends createZodDto(DeleteNodeSchema) {}
