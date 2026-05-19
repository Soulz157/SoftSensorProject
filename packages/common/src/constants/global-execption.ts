import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  ImATeapotException,
  InternalServerErrorException,
  MethodNotAllowedException,
  NotAcceptableException,
  NotFoundException,
  NotImplementedException,
  PayloadTooLargeException,
  PreconditionFailedException,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
export declare const HTTP_ERRORS_BY_CODE: {
  readonly 502: typeof BadGatewayException
  readonly 400: typeof BadRequestException
  readonly 409: typeof ConflictException
  readonly 403: typeof ForbiddenException
  readonly 504: typeof GatewayTimeoutException
  readonly 410: typeof GoneException
  readonly 418: typeof ImATeapotException
  readonly 500: typeof InternalServerErrorException
  readonly 405: typeof MethodNotAllowedException
  readonly 406: typeof NotAcceptableException
  readonly 404: typeof NotFoundException
  readonly 501: typeof NotImplementedException
  readonly 413: typeof PayloadTooLargeException
  readonly 412: typeof PreconditionFailedException
  readonly 408: typeof RequestTimeoutException
  readonly 503: typeof ServiceUnavailableException
  readonly 401: typeof UnauthorizedException
  readonly 422: typeof UnprocessableEntityException
  readonly 415: typeof UnsupportedMediaTypeException
}
