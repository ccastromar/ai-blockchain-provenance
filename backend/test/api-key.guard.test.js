const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');
const { ApiKeyGuard } = require('../dist/common/api-key.guard');

function contextWithHeader(value) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return {
            headers: {
              'x-ernest-api-key': value,
            },
          };
        },
      };
    },
  };
}

test('ApiKeyGuard allows requests when ERNEST_API_KEY is not configured', () => {
  const previous = process.env.ERNEST_API_KEY;
  delete process.env.ERNEST_API_KEY;

  try {
    const guard = new ApiKeyGuard();
    assert.equal(guard.canActivate(contextWithHeader(undefined)), true);
  } finally {
    if (previous !== undefined) {
      process.env.ERNEST_API_KEY = previous;
    }
  }
});

test('ApiKeyGuard accepts a matching X-Ernest-Api-Key header', () => {
  const previous = process.env.ERNEST_API_KEY;
  process.env.ERNEST_API_KEY = 'secret-key';

  try {
    const guard = new ApiKeyGuard();
    assert.equal(guard.canActivate(contextWithHeader('secret-key')), true);
  } finally {
    if (previous === undefined) {
      delete process.env.ERNEST_API_KEY;
    } else {
      process.env.ERNEST_API_KEY = previous;
    }
  }
});

test('ApiKeyGuard rejects a missing or invalid key when configured', () => {
  const previous = process.env.ERNEST_API_KEY;
  process.env.ERNEST_API_KEY = 'secret-key';

  try {
    const guard = new ApiKeyGuard();
    assert.throws(
      () => guard.canActivate(contextWithHeader('wrong-key')),
      UnauthorizedException,
    );
    assert.throws(
      () => guard.canActivate(contextWithHeader(undefined)),
      UnauthorizedException,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ERNEST_API_KEY;
    } else {
      process.env.ERNEST_API_KEY = previous;
    }
  }
});
