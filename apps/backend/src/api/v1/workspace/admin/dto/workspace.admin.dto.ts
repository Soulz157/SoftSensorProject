import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { createStandardResponseSchema } from 'src/lib/dto';

export const CreateWorkspaceResponseSchema = createStandardResponseSchema(
  z.object({
    workspaceId: z.string(),
    message: z.string(),
  }),
);

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().min(1, 'ชื่อ workspace ต้องไม่ว่างเปล่า'),
  color: z.string().min(1, 'สี workspace ต้องไม่ว่างเปล่า'),
  icon: z.string().min(1, 'ไอคอน workspace ต้องไม่ว่างเปล่า'),
});

export const UpdateWorkspaceRequestSchema = z.object({
  name: z.string().min(1, 'ชื่อ workspace ต้องไม่ว่างเปล่า').optional(),
  color: z.string().min(1, 'สี workspace ต้องไม่ว่างเปล่า').optional(),
  icon: z.string().min(1, 'ไอคอน workspace ต้องไม่ว่างเปล่า').optional(),
});

export const UpdateWorkspaceResponseSchema = createStandardResponseSchema(
  z.object({
    message: z.string(),
  }),
);

export const DeleteWorkspaceRequestSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId ต้องไม่ว่างเปล่า'),
});

export const DeleteWorkspaceResponseSchema = createStandardResponseSchema(
  z.object({
    message: z.string(),
  }),
);

export class CreateWorkspaceRequestDto extends createZodDto(
  CreateWorkspaceRequestSchema,
) {}

export class CreateWorkspaceResponseDto extends createZodDto(
  CreateWorkspaceResponseSchema,
) {}

export class DeleteWorkspaceRequestDto extends createZodDto(
  DeleteWorkspaceRequestSchema,
) {}

export class DeleteWorkspaceResponseDto extends createZodDto(
  DeleteWorkspaceResponseSchema,
) {}

export class UpdateWorkspaceRequestDto extends createZodDto(
  UpdateWorkspaceRequestSchema,
) {}

export class UpdateWorkspaceResponseDto extends createZodDto(
  UpdateWorkspaceResponseSchema,
) {}
