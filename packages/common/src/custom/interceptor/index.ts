import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

export interface Response<T> {
  statusCode?: number | undefined
  message: string
  data: T | null
  type: 'SUCCESS' | 'ERROR' | 'WARNING' | 'WAIT'
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const ctx = context.switchToHttp()
    const response = ctx.getResponse()
    return next.handle().pipe(
      map((data: Response<T>) => {
        response.status(data?.statusCode ?? 200)
        const res: Response<T> = {
          message: data?.message ?? 'OK',
          data: data?.data ?? null,
          type: data?.type ?? 'SUCCESS',
        }
        return res
      }),
    )
  }
}
