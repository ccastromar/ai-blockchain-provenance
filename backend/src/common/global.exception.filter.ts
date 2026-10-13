import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isDuplicateKey = exception?.code === 11000;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : isDuplicateKey
          ? HttpStatus.CONFLICT
          : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '';
    if (exception instanceof HttpException) {
      const resp = exception.getResponse() as { message?: string; error?: string };
      message =
        typeof resp === 'string'
          ? resp
          : resp?.message || resp?.error || exception.message;
    } else if (isDuplicateKey) {
      message = 'Duplicate resource';
    } else {
      message = exception?.message || exception.toString();
    }

    // Server faults get the full stack. Client errors are expected traffic: one line, no
    // stack — and rate-limit rejections are not logged at all, or a client hammering a
    // throttled route writes gigabytes of identical stack traces (seen under load).
    if (status >= 500) {
      console.error(`GlobalExceptionFilter [${request.method} ${request.url}]:`, message, exception?.stack || exception);
    } else if (status !== HttpStatus.TOO_MANY_REQUESTS) {
      console.warn(`GlobalExceptionFilter [${request.method} ${request.url}] ${status}: ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
