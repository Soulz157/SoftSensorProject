import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '@softsensor/prisma';
import { LoginRequestDto, RegisterRequestDto } from './dto/auth.public.dto';
import { AppException } from '@softsensor/common';

@Injectable()
export class AuthPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
        role: 'USER',
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

  async loginService(args: LoginRequestDto) {
    const { email, password } = args;
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

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

    const token = this.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      message: 'เข้าสู่ระบบสำเร็จ',
      data: {
        accessToken: token,
      },
    };
  }

  // async oauthLogin(dto: OAuthLoginDto) {
  //   const {
  //     provider,
  //     providerAccountId,
  //     email,
  //     name,
  //     accessToken,
  //     refreshToken,
  //     expiresAt,
  //   } = dto;

  //   const existingAccount = await this.prisma.account.findUnique({
  //     where: { provider_providerAccountId: { provider, providerAccountId } },
  //     include: { user: true },
  //   });

  //   if (!email) {
  //     throw new AppException(
  //       statusCode: 400,
  //       message: 'Email is required from OAuth provider',
  //       type: "ERROR" ,
  //     );
  //   }

  //   if (existingAccount) {
  //     return this.issueToken(existingAccount.user);
  //   }

  //   const existingUser = await this.prisma.user.findUnique({
  //     where: { email },
  //   });

  //   const user = existingUser
  //     ? await this.prisma.account
  //         .create({
  //           data: {
  //             userId: existingUser.id,
  //             provider,
  //             providerAccountId,
  //             accessToken,
  //             refreshToken,
  //             expiresAt,
  //           },
  //           select: { user: true },
  //         })
  //         .then((a) => a.user)
  //     : await this.prisma.user.create({
  //         data: {
  //           email,
  //           username: name,
  //           accounts: {
  //             create: {
  //               provider,
  //               providerAccountId,
  //               accessToken,
  //               refreshToken,
  //               expiresAt,
  //             },
  //           },
  //         },
  //       });

  //   return this.issueToken(user);
  // }

  // private issueToken(user: { id: string; email: string; role: string }) {
  //   const token = this.jwt.sign({
  //     id: user.id,
  //     email: user.email,
  //     role: user.role,
  //   });
  //   return { accessToken: token };
  // }
}
