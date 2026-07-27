import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateDataSourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['aveva', 'sql', 'csv', 'api']),
  host: z.string().default(''),
  username: z.string().default(''),
  // Plaintext connection secret from the user (password / API key / token).
  // The service encrypts it into DataSource.secretCiphertext — it is never
  // stored plaintext and never returned in responses.
  password: z.string().default(''),
  dbName: z.string().default(''),
  // Non-secret, type-specific connection fields (sql: port/driver;
  // rest: baseUrl/endpoint/method/authType/apiKeyName/headers).
  config: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateDataSourceSchema = CreateDataSourceSchema.partial();

export class CreateDataSourceDto extends createZodDto(CreateDataSourceSchema) {}
export class UpdateDataSourceDto extends createZodDto(UpdateDataSourceSchema) {}
