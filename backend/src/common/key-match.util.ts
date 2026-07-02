import { timingSafeEqual } from 'crypto';

/** Constant-time comparison of a caller-provided key against an expected secret. */
export function timingSafeKeyMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
