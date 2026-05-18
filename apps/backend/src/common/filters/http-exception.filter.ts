import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const response = exception.getResponse();
    const message =
      typeof response === 'string'
        ? response
        : ((response as Record<string, unknown>).message ?? exception.message);

    reply.status(status).send({
      statusCode: status,
      message,
      error: (response as Record<string, unknown>).error ?? exception.name,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
