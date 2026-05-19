import z from 'zod';
import { createZodDto } from 'nestjs-zod';
import { createStandardResponseSchema } from 'src/lib/dto';
import { Role } from 'node_modules/@softsensor/prisma/dist/src/generated/client/enums';

export const GetMeResponseSchema = createStandardResponseSchema(
  z
    .object({
      id: z.string(),
      email: z.email(),
      name: z.string(),
    })
    .strict(),
);

export const LogoutResponeSchema = createStandardResponseSchema(
  z.object({
    message: z.string().default('Logged out successfully'),
  }),
);

export const EditRequestSchema = z
  .object({
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    email: z.email().optional(),
    role: z.enum(Role).optional(),
    password: z.string().optional(),
  })
  .strict();

export class GetMeResponseDto extends createZodDto(GetMeResponseSchema) {}
export class LogoutResponseDto extends createZodDto(LogoutResponeSchema) {}
export class EditRequestDto extends createZodDto(EditRequestSchema) {}
