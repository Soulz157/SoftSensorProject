import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import {
  LoginRequestDto,
  OAuthLoginRequestDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
} from './dto/auth.public.dto';
import { AppException } from '@softsensor/common';
import { REFRESH_TOKEN_TTL_MS } from '@/config/cookie.config';
import { MailAuthorizedService } from '../../mail/authorized/mail.authorized.service';

interface MicrosoftGraphProfile {
  id: string;
  mail: string | null;
  userPrincipalName: string;
  givenName: string | null;
  surname: string | null;
  displayName: string | null;
}

interface LoginMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailAuthorizedService,
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

  async oauthLoginService(
    args: OAuthLoginRequestDto,
    meta?: LoginMeta,
  ): Promise<{ response: object; refreshToken: string }> {
    // 1. Provider guard — Google ships later
    if (args.provider !== 'microsoft') {
      throw new BadRequestException('Provider not supported');
    }

    // 2. Verify the Microsoft access token against Microsoft Graph
    const graphRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    });

    if (!graphRes.ok) {
      throw new UnauthorizedException('Invalid Microsoft access token');
    }

    const profile = (await graphRes.json()) as MicrosoftGraphProfile;
    const graphEmail = (
      profile.mail ?? profile.userPrincipalName
    ).toLowerCase();

    // 3. Anti-spoof check — body must match Graph's authoritative identity
    if (
      profile.id !== args.providerAccountId ||
      graphEmail !== args.email.toLowerCase()
    ) {
      throw new UnauthorizedException('OAuth identity mismatch');
    }

    // 4. Resolve user via Account first, then by email, else auto-provision.
    //    We do not persist Microsoft tokens (accessToken/refreshToken/expiresAt
    //    remain null) until a downstream use-case requires them.
    const existingAccount = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'microsoft',
          providerAccountId: profile.id,
        },
      },
      include: { user: true },
    });

    let user = existingAccount?.user ?? null;

    if (!user) {
      const userByEmail = await this.prisma.user.findUnique({
        where: { email: graphEmail },
      });

      if (userByEmail) {
        user = userByEmail;
        await this.prisma.account.create({
          data: {
            userId: user.id,
            provider: 'microsoft',
            providerAccountId: profile.id,
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
          },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: graphEmail,
            firstName: profile.givenName ?? '',
            lastName: profile.surname ?? '',
            password: null,
            role: PrismaEnums.Role.USER,
            accounts: {
              create: {
                provider: 'microsoft',
                providerAccountId: profile.id,
                accessToken: null,
                refreshToken: null,
                expiresAt: null,
              },
            },
          },
        });
      }
    }

    if (!user) {
      throw new AppException({
        statusCode: 500,
        message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ',
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
        message: 'OAuth login successful',
        data: { accessToken },
      },
      refreshToken,
    };
  }

  async forgotPasswordService(email: string) {
    const silentSuccess = {
      statusCode: 200,
      message: 'เราได้ส่งอีเมลสำหรับรีเซ็ตรหัสผ่านไปให้แล้ว',
      type: 'SUCCESS',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return silentSuccess;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:3000';
    const resetUrl = `${clientUrl}/reset-password/${token}?email=${encodeURIComponent(user.email)}`;

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      }),
    ]);

    await this.mailerService.sendPasswordResetEmail(email, resetUrl);

    return silentSuccess;
  }

  async changePasswordService(args: ResetPasswordRequestDto) {
    const { email, token } = args;
    const user = await this.prisma.user.findUnique({
      where: { email: email },
      include: { passwordResetTokens: true },
    });

    if (!user) {
      throw new AppException({
        statusCode: 404,
        message: 'User not found',
        type: 'ERROR',
      });
    }
    const isTokenValid = user.passwordResetTokens.some(
      (t) => t.token === token,
    );
    const isTokenNotExpired = user.passwordResetTokens.some(
      (t) => t.expiresAt > new Date(),
    );

    if (!isTokenValid || !isTokenNotExpired) {
      throw new AppException({
        statusCode: 400,
        message: 'Invalid or expired reset token',
        type: 'ERROR',
      });
    }

    const newHashedPassword = await argon2.hash(args.password);

    await this.prisma.user.update({
      where: { email: user.email },
      data: { password: newHashedPassword },
    });

    return {
      statusCode: 200,
      message: 'Password changed successfully',
      type: 'SUCCESS',
    };
  }
}
