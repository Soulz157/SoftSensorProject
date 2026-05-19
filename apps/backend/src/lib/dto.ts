import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const createStandardResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T,
) => {
  return z.object({
    status: z.number().default(200),
    message: z.string().default('Success'),
    data: dataSchema,
    timestamp: z.string().default(new Date().toISOString()),
  });
};

export class ResponseFailedDto extends createZodDto(
  z.object({
    message: z.string(),
    type: z.enum(['ERROR', 'SUCCESS', 'WARNING', 'WAIT']),
  }),
) {}

export class ResponseOkDto extends createZodDto(
  z.object({
    message: z.string(),
    type: z.enum(['SUCCESS', 'ERROR', 'WARNING', 'WAIT']),
  }),
) {}
