import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@softsensor/prisma';
import { AuthModule } from './api/auth/auth.module';
import { WorkspaceModule } from './api/workspace/workspace.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    WorkspaceModule,
  ],
})
export class AppModule {}
