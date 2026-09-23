import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ApiErrorCode, type ApiFieldError } from './api-error';

function flatten(errors: ValidationError[], parent = ''): ApiFieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    const children = error.children?.length ? flatten(error.children, field) : [];
    return [...own, ...children];
  });
}

/** Strips unknown properties, rejects them explicitly, and reports failures per field. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        code: ApiErrorCode.VALIDATION_FAILED,
        message: 'Request validation failed.',
        details: flatten(errors),
      }),
  });
}
