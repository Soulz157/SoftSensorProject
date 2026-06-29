import { NestFactory, Reflector } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  ClassSerializerInterceptor,
  Logger,
  // ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import path from 'path';
// import fastifyHelmet from '@fastify/helmet';
// import fastifyCompress from '@fastify/compress';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

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
    exclude: ['/swagger', '/swagger/{*path}'],
  });

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
  });

  // app.useGlobalPipes(
  //   new ValidationPipe({
  //     whitelist: true,
  //     transform: true,
  //     forbidNonWhitelisted: true,
  //   }),
  // );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const config = new DocumentBuilder()
    .setTitle('Soft Sensor API')
    .setDescription('API documentation for the Soft Sensor project')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('/api')
    .build();

  const documentFactory = () =>
    cleanupOpenApiDoc(SwaggerModule.createDocument(app, config, {}));

  SwaggerModule.setup('swagger', app, documentFactory, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

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
  const host = '0.0.0.0';

  await app.listen(port, host);
  logger.log(
    `Application running on port ${port} [${configService.get('NODE_ENV', 'development')}]`,
  );

  logger.log(`Swagger available at http://localhost:${port}/swagger`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
