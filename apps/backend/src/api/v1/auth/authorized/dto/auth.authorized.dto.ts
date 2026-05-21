import z from 'zod';
import { createZodDto } from 'nestjs-zod';
import { createStandardResponseSchema } from 'src/lib/dto';
import { Role } from 'node_modules/@softsensor/prisma/dist/src/generated/client/enums';

export const GetMeResponseSchema = createStandardResponseSchema(
  z
    .object({
      id: z.string(),
      email: z.email(),
      firstName: z.string(),
      lastName: z.string(),
      company: z.string().nullable(),
    })
    .strict(),
);

export const LogoutResponseSchema = createStandardResponseSchema(
  z.object({
    message: z.string().default('Logged out successfully'),
  }),
);

export const EditRequestSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    company: z.string().optional().default(''),
    email: z.email().optional(),
    role: z.enum(Role).optional(),
    password: z.string().optional(),
  })
  .strict();

export const EditResponseSchema = createStandardResponseSchema(
  z.object({
    message: z.string().default('อัปเดตข้อมูลผู้ใช้สำเร็จ'),
  }),
);

export const RefreshResponseSchema = createStandardResponseSchema(
  z.object({
    accessToken: z.string(),
  }),
);

export class RefreshResponseDto extends createZodDto(RefreshResponseSchema) {}
export class GetMeResponseDto extends createZodDto(GetMeResponseSchema) {}
export class LogoutResponseDto extends createZodDto(LogoutResponseSchema) {}
export class EditRequestDto extends createZodDto(EditRequestSchema) {}
export class EditResponseDto extends createZodDto(EditResponseSchema) {}
