import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

const API_KEY_HEADER = 'x-ernest-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedKey = process.env.ERNEST_API_KEY;
    if (!expectedKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headerValue = request.headers[API_KEY_HEADER];
    const actualKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!actualKey || !this.matches(actualKey, expectedKey)) {
      throw new UnauthorizedException('Invalid or missing Ernest API key');
    }

    return true;
  }

  private matches(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
