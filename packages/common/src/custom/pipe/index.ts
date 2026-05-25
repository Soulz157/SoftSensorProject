import {
  HttpStatus,
  Injectable,
  PipeTransform,
  ArgumentMetadata,
} from '@nestjs/common'
import { ZodError, ZodSchema } from 'zod'
import { AppException } from '../filter'

interface ZodMetatype {
  zodSchema?: ZodSchema
  schema?: ZodSchema
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly errorHttpStatusCode = HttpStatus.BAD_REQUEST

  transform(value: unknown, metadata: ArgumentMetadata) {
    const metatype = metadata.metatype as unknown as ZodMetatype | undefined

    const schema = metatype?.zodSchema || metatype?.schema

    if (!schema) return value

    const parsedValue = schema.safeParse(value)

    if (!parsedValue.success) {
      throw this.buildException(parsedValue.error)
    }

    return parsedValue.data
  }

  private buildException(error: ZodError): AppException {
    const firstError = error.issues[0]
    return new AppException({
      message: firstError?.message || 'Validation failed',
      statusCode: this.errorHttpStatusCode,
      type: 'ERROR',
    })
  }
}
