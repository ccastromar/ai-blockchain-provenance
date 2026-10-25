const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { SignJWT, exportJWK, generateKeyPair } = require('jose');

// A bearer token is accepted only from the configured issuer, for the configured audience, with an
// expiry, and signed with a key the provider publishes. Anything else grants nothing (null).

const ISSUER = 'http://idp.test';

test('OIDC verification needs issuer, audience, expiry and a published key', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const server = http.createServer((_, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const saved = { ...process.env };
  t.after(() => {
    for (const key of ['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URI']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_AUDIENCE = 'ernest-spa';
  process.env.OIDC_JWKS_URI = `http://127.0.0.1:${server.address().port}/jwks`;
  const { OidcService } = require('../dist/auth/oidc.service');
  const oidc = new OidcService();

  const sign = ({ issuer = ISSUER, audience = 'ernest-spa', expires = '5m', key = privateKey } = {}) => {
    let jwt = new SignJWT({ roles: ['ernest-reader'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('alice');
    if (expires) jwt = jwt.setExpirationTime(expires);
    return jwt.sign(key);
  };

  const principal = await oidc.verify(await sign());
  assert.equal(principal.subject, 'alice');
  assert.deepEqual(principal.functions, ['audit']);

  const { privateKey: stranger } = await generateKeyPair('RS256');
  const refused = {
    'another issuer': await sign({ issuer: 'http://other.test' }),
    "another app's audience": await sign({ audience: 'prudence-api' }),
    'no expiry': await sign({ expires: null }),
    expired: await sign({ expires: Math.floor(Date.now() / 1000) - 3600 }),
    'a key the provider does not publish': await sign({ key: stranger }),
  };
  for (const [name, token] of Object.entries(refused)) {
    assert.equal(await oidc.verify(token), null, name);
  }
});
