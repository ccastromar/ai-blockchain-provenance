import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '';
    if (exception instanceof HttpException) {
      const resp = exception.getResponse() as { message?: string; error?: string };
      message =
        typeof resp === 'string'
          ? resp
          : resp?.message || resp?.error || exception.message;
    } else {
      message = exception?.message || exception.toString();
    }

    console.error(
      `GlobalExceptionFilter [${request.method} ${request.url}]:`,
      message,
      exception?.stack || exception,
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
