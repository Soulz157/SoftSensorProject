import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger, VersioningType } from '@nestjs/common';
import fastifyCors from '@fastify/cors';
import { cleanupOpenApiDoc } from 'nestjs-zod';
// import fastifyHelmet from '@fastify/helmet';
// import fastifyCompress from '@fastify/compress';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 50 * 1024 * 1024,
      logger: false,
      trustProxy: true,
    }),
    {
      bufferLogs: true,
    },
  );

  app.setGlobalPrefix('api', {
    exclude: ['/health', '/swagger(.*)'],
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const isProduction = configService.get('NODE_ENV') === 'production';

  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Soft Sensor API')
      .setDescription('API documentation for the Soft Sensor project')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer('/api')
      .build();

    const documentFactory = () =>
      cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));

    SwaggerModule.setup('swagger', app, documentFactory, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Https security headers
  // await app.register(fastifyHelmet, {
  //   contentSecurityPolicy: true,
  // });

  // Compression for responses
  // await app.register(fastifyCompress, {
  //   encodings: ['gzip', 'deflate'],
  // });

  await app.register(fastifyCors, {
    origin: configService.get<string>('CORS_ORIGINS', '*').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  app.enableShutdownHooks();

  const port = configService.get<number>('SERVER_PORT', 8000);
  const host = '0.0.0.0'; // bind ทุก interface สำหรับ container

  await app.listen(port, host);
  logger.log(
    `Application running on port ${port} [${configService.get('NODE_ENV', 'development')}]`,
  );

  if (!isProduction) {
    logger.log(`Swagger available at http://localhost:${port}/swagger`);
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
