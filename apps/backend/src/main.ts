import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // const documentFactory = () => SwaggerModule.createDocument(app, config, {});
  // SwaggerModule.setup('swagger', app, cleanupOpenApiDoc(documentFactory()));

  await app.listen(process.env.SERVER_PORT ?? 8000);
}
bootstrap();
