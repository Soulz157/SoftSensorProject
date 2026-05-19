import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { createStandardResponseSchema } from 'src/lib/dto';

export const OAuthLoginSchema = createStandardResponseSchema(
  z.object({
    provider: z.enum(['google', 'microsoft']),
    providerAccountId: z.string().min(1),
    email: z.string().email(),
    name: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().int().optional(),
  }),
);

export const RegisterRequestSchema = z
  .object({
    email: z
      .email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' })
      .min(1, 'อีเมลต้องไม่ว่างเปล่า'),
    password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
    confirmPassword: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
    firstName: z.string().min(1, 'ชื่อต้องไม่ว่างเปล่า'),
    lastName: z.string().min(1, 'นามสกุลต้องไม่ว่างเปล่า'),
    company: z.string().optional().default(''),
    role: z.enum(['USER', 'ADMIN']).default('USER').optional(),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: 'รหัสผ่านไม่ตรงกัน',
    path: ['confirmPassword'],
  });

export const RegisterResponseSchema = createStandardResponseSchema(
  z.object({
    message: z.string(),
  }),
);

export const LoginRequestSchema = z
  .object({
    email: z
      .email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' })
      .min(1, 'อีเมลต้องไม่ว่างเปล่า'),
    password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
  })
  .strict();

export const LoginResponseSchema = createStandardResponseSchema(
  z.object({
    message: z.string(),
    accessToken: z.string(),
  }),
);

export class RegisterRequestDto extends createZodDto(RegisterRequestSchema) {}
export class RegisterResponseDto extends createZodDto(RegisterResponseSchema) {}
export class OAuthLoginDto extends createZodDto(OAuthLoginSchema) {}
export class LoginRequestDto extends createZodDto(LoginRequestSchema) {}
export class LoginResponseDto extends createZodDto(LoginResponseSchema) {}
