import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import { LoginRequestDto, RegisterRequestDto } from './dto/auth.public.dto';
import { AppException } from '@softsensor/common';
import { REFRESH_TOKEN_TTL_MS } from '@/config/cookie.config';

interface LoginMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async registerService(args: RegisterRequestDto) {
    const { email, password, firstName, lastName, company } = args;
    const hash = await argon2.hash(password);

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new AppException({
        statusCode: 400,
        message: 'Email already in use',
        type: 'ERROR',
      });
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hash,
        firstName,
        lastName,
        company,
        role: PrismaEnums.Role.USER,
      },
    });

    if (!user) {
      throw new AppException({
        statusCode: 500,
        message: 'เกิดข้อผิดพลาดในการสร้างบัญชีผู้ใช้',
        type: 'ERROR',
      });
    }

    return {
      statusCode: 201,
      message: 'สร้างบัญชีผู้ใช้สำเร็จ',
      type: 'SUCCESS',
    };
  }

  async loginService(
    args: LoginRequestDto,
    meta?: LoginMeta,
  ): Promise<{ response: object; refreshToken: string }> {
    const { email, password } = args;
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new AppException({
        statusCode: 400,
        message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
        type: 'ERROR',
      });
    }

    if (!user.password) {
      throw new AppException({
        statusCode: 400,
        message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ',
        type: 'ERROR',
      });
    }

    const isPasswordValid = await argon2.verify(user.password, password);
    if (!isPasswordValid) {
      throw new AppException({
        statusCode: 400,
        message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
        type: 'ERROR',
      });
    }

    const accessToken = this.jwtService.sign<Auth.UserPayload>(
      {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        company: user.company ?? '',
        role: user.role,
      },
      { expiresIn: '15m' },
    );

    const refreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: { token: refreshToken, userId: user.id, expiresAt },
      }),
      this.prisma.authLog.create({
        data: {
          userId: user.id,
          action: PrismaEnums.AuthAction.LOGIN,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      }),
    ]);

    return {
      response: {
        statusCode: 200,
        message: 'เข้าสู่ระบบสำเร็จ',
        type: 'SUCCESS',
        data: { accessToken },
      },
      refreshToken,
    };
  }
}
