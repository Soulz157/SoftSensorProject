import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const AssignPlanSchema = z.object({
  planId: z.string(),
});

export const CreatePlanSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0).default(0),
  durationMonths: z.number().min(1).default(1),
});

export class CreatePlanDto extends createZodDto(CreatePlanSchema) {}

export class AssignPlanDto extends createZodDto(AssignPlanSchema) {}
