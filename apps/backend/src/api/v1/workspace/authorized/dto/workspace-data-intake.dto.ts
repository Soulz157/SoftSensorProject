import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { INTAKE_RANGES } from '@/lib/data-intake';

export const DataIntakeQuerySchema = z.object({
  range: z.enum(INTAKE_RANGES).default('24h'),
});

export class DataIntakeQueryDto extends createZodDto(DataIntakeQuerySchema) {}
