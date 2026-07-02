import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateDataSourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['aveva', 'sql', 'csv', 'api']),
  host: z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
  dbName: z.string().default(''),
});

export const UpdateDataSourceSchema = CreateDataSourceSchema.partial();

export class CreateDataSourceDto extends createZodDto(CreateDataSourceSchema) {}
export class UpdateDataSourceDto extends createZodDto(UpdateDataSourceSchema) {}
