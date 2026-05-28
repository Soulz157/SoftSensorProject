import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const AssignPlanSchema = z.object({
  planId: z.string(),
});

export class AssignPlanDto extends createZodDto(AssignPlanSchema) {}
