import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { JwtModule } from '@nestjs/jwt';
import {
  ZodValidationPipe as AppZodValidationPipe,
  AllExceptionsFilter,
} from '@softsensor/common';
import { APP_PIPE, APP_FILTER } from '@nestjs/core';
import { PrismaModule } from '@softsensor/prisma';
import { AuthModule } from './api/v1/auth/auth.module';
import { WorkspaceModule } from './api/v1/workspace/workspace.module';
import { MailModule } from './api/v1/mail/mail.module';
import { PlanModule } from './api/v1/plan/plan.module';
import { NodesModule } from './api/v1/nodes/nodes.module';
import { WorkspacePlantModule } from './api/v1/workspace-plant/workspace.plant.module';
import { ModelModule } from './api/v1/model/model.module';
import { DataSourceModule } from './api/v1/data-source/data-source.module';
import { DatasetModule } from './api/v1/dataset/dataset.module';
import { DatasetVersionModule } from './api/v1/dataset-version/dataset-version.module';
import { DatasetDraftModule } from './api/v1/dataset-draft/dataset-draft.module';
import { ModelDraftModule } from './api/v1/model-draft/model-draft.module';
import { FeaturePresetModule } from './api/v1/feature-preset/feature.preset.module';
import { ArtifactCleanupModule } from './api/v1/artifact-cleanup/artifact-cleanup.module';
import { ModelDraftCleanupModule } from './api/v1/model-draft-cleanup/model-draft-cleanup.module';
import { ModelRunModule } from './api/v1/model-run/model-run.module';
import { TrainningContainerModule } from './api/v1/trainning-container/trainning-container.module';

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
    PlanModule,
    NodesModule,
    WorkspacePlantModule,
    ModelModule,
    DataSourceModule,
    DatasetModule,
    DatasetVersionModule,
    DatasetDraftModule,
    ModelDraftModule,
    FeaturePresetModule,
    ArtifactCleanupModule,
    ModelDraftCleanupModule,
    ModelRunModule,
    TrainningContainerModule,
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
