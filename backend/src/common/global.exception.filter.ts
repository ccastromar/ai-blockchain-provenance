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
    // The route, not the URL: a query string or a path segment may carry what was sent. A
    // server fault is logged as its error (in JSON logs: its type and frames, not its message).
    const route = request.route?.path || request.path;
    if (status >= 500) {
      console.error(`GlobalExceptionFilter [${request.method} ${route}]:`, exception instanceof Error ? exception : message);
    } else if (status !== HttpStatus.TOO_MANY_REQUESTS) {
      console.warn(`GlobalExceptionFilter [${request.method} ${route}] ${status}: ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
