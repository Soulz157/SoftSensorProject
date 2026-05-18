import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { ApiResponse, ResponseType } from '../../types'

export class AppException extends Error {
  readonly statusCode: number
  readonly type: ResponseType
  readonly isException: boolean

  constructor({
    statusCode = 400,
    type = 'ERROR',
    message,
    isException = false,
  }: Partial<ApiResponse>) {
    super(message)
    this.statusCode = statusCode
    this.type = type
    this.isException = isException
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<FastifyReply>()

    const response = this.buildResponse(exception)

    if (response.statusCode >= 500) {
      Logger.error(
        (exception as any)?.message ?? response.message,
        (exception as any)?.stack,
        'AllExceptionsFilter',
      )
    }

    res.status(response.statusCode ?? 400).send({
      statusCode: response.statusCode,
      message: response.message,
      data: response.data ?? null,
      timestamp: response.timestamp,
    })
  }

  private buildResponse(exception: unknown): ApiResponse {
    const base: ApiResponse = {
      message: 'Something went wrong',
      data: undefined,
      type: 'ERROR',
      timestamp: new Date().toISOString(),
      statusCode: 500,
      isException: false,
    }

    if (exception instanceof AppException) {
      return {
        ...base,
        message: exception.message,
        statusCode: exception.statusCode,
        type: exception.type,
        isException: exception.isException,
      }
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse() as any
      return {
        ...base,
        message: Array.isArray(res?.message)
          ? res.message[0]
          : (res?.message ?? exception.message),
        statusCode: exception.getStatus(),
        type: 'ERROR',
      }
    }

    if (exception instanceof Error) {
      return {
        ...base,
        message: exception.message,
        type: 'ERROR',
        statusCode: 500,
      }
    }

    return base
  }
}
