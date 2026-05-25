import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '@softsensor/prisma';
import { AuthModule } from './api/v1/auth/auth.module';
import { WorkspaceModule } from './api/v1/workspace/workspace.module';
import { MailModule } from './api/v1/mail/mail.module';
import {
  ZodValidationPipe as AppZodValidationPipe,
  AllExceptionsFilter,
} from '@softsensor/common';
import { APP_PIPE, APP_FILTER } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    MailerModule.forRoot({
      transport: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      },
      defaults: {
        from: `"SoftSensor Platform 🚀" <${process.env.SMTP_FROM}>`,
      },
    }),

    JwtModule.register({
      global: true,
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    WorkspaceModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: AppZodValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
