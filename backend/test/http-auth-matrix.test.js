// HTTP-layer integration suite: boots the real AppModule (real guards wired through
// APP_GUARD, real routes, real Mongo persistence) and asserts the credential matrix
// end to end. Unit tests on the guard classes cannot see wiring gaps -- the
// unguarded PATCH /api/models/:id/status shipped precisely because nothing tested
// the HTTP surface; this file exists so that class of bug fails CI instead.
//
// Requires a reachable MongoDB (local docker stack or the CI service container).
// Uses a throwaway database, dropped afterwards. No extra test dependencies: the
// production NestFactory listening on an ephemeral port, exercised with fetch.
const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');

const MONGO_HOST = process.env.HTTP_TEST_MONGO_HOST || '127.0.0.1';
const MONGO_PORT = Number(process.env.HTTP_TEST_MONGO_PORT || 27017);

const WRITE_KEY = 'it-write-key';
const READ_KEY = 'it-read-key';

function mongoReachable() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: MONGO_HOST, port: MONGO_PORT, timeout: 1500 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

const HASH_A = '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d';
const HASH_B = '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6';
const GIT_COMMIT = 'a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2';

const MODEL_PAYLOAD = {
  modelId: 'it-http-model-v1',
  modelName: 'HTTP Matrix Model',
  version: '1.0.0',
  mlflow: { modelHash: HASH_A, gitCommit: GIT_COMMIT },
};

test('HTTP auth matrix against the real application', async (t) => {
  if (!(await mongoReachable())) {
    t.skip(`MongoDB not reachable at ${MONGO_HOST}:${MONGO_PORT} — start the docker stack to run the HTTP matrix`);
    return;
  }

  // Environment must be set before requiring dist: the @Module decorator evaluates
  // MongooseModule.forRoot at import time.
  const dbName = `ernest_http_matrix_${process.pid}`;
  process.env.MONGODB_URI = `mongodb://${MONGO_HOST}:${MONGO_PORT}/${dbName}?serverSelectionTimeoutMS=3000`;
  process.env.ERNEST_API_KEY = WRITE_KEY;
  process.env.ERNEST_READ_API_KEY = READ_KEY;
  delete process.env.WEBHOOK_URL;
  delete process.env.INFURA_URL;

  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { getConnectionToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../dist/app.module');
  const { GlobalExceptionFilter } = require('../dist/common/global.exception.filter');

  const app = await NestFactory.create(AppModule, { logger: false });
  // Mirror bootstrap() in main.ts so DTO validation behaves like production.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(0);
  const base = await app.getUrl();

  const call = async (method, path, { key, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['X-Ernest-Api-Key'] = key;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch { /* some replies have no body */ }
    return { status: response.status, body: json };
  };

  try {
    await t.test('exempt routes stay open without a key', async () => {
      assert.equal((await call('GET', '/health')).status, 200);
      const whoami = await call('GET', '/api/auth/whoami');
      assert.equal(whoami.status, 200);
      assert.deepEqual(whoami.body, { role: 'anonymous', openAccess: false });
    });

    await t.test('anonymous callers are rejected on every gated route', async () => {
      for (const [method, path] of [
        ['GET', '/api/models'],
        ['GET', '/api/blocks'],
        ['GET', '/api/blocks/export'],
        ['GET', '/api/blocks/0/proof'],
        ['GET', '/api/verify'],
        ['GET', '/api/stats'],
        ['GET', '/api/ingested-events'],
        ['POST', '/api/models'],
        ['POST', '/api/inferences'],
        ['POST', '/api/demo/seed'],
        ['PATCH', '/api/models/some-model/status'],
        ['POST', '/api/auth/tokens'],
        ['GET', '/api/auth/tokens'],
        ['DELETE', '/api/auth/tokens/000000000000000000000000'],
        ['POST', '/api/auth/emitters'],
        ['GET', '/api/auth/emitters'],
        ['DELETE', '/api/auth/emitters/0000000000000000'],
        ['POST', '/api/ingestor/simulate/huggingface'],
      ]) {
        const { status } = await call(method, path, { body: method === 'GET' ? undefined : {} });
        assert.equal(status, 401, `${method} ${path} should 401 for anonymous, got ${status}`);
      }
    });

    await t.test('read-only key: reads succeed, every write path stays closed', async () => {
      const whoami = await call('GET', '/api/auth/whoami', { key: READ_KEY });
      assert.deepEqual(whoami.body, { role: 'read-only', openAccess: false });

      for (const path of ['/api/models', '/api/blocks', '/api/verify', '/api/stats']) {
        const { status } = await call('GET', path, { key: READ_KEY });
        assert.equal(status, 200, `GET ${path} should be readable with the read key, got ${status}`);
      }

      // Route-order lock: "export" must reach its own handler, not blocks/:index.
      const exported = await call('GET', '/api/blocks/export', { key: READ_KEY });
      assert.equal(exported.status, 200);
      assert.ok(Array.isArray(exported.body.blocks), 'export bundle must contain a blocks array');
      assert.equal(exported.body.blocks[0].index, 0, 'export starts at the genesis block');

      for (const [method, path, body] of [
        ['POST', '/api/models', MODEL_PAYLOAD],
        ['POST', '/api/inferences', { modelId: 'x', inferenceId: 'i', inputHash: HASH_A, outputHash: HASH_B }],
        ['POST', '/api/demo/seed', {}],
        // The write-guard gap that shipped once: status changes with a read credential.
        ['PATCH', '/api/models/some-model/status', { status: 'archived' }],
        ['POST', '/api/auth/tokens', { label: 'nope', role: 'read-only' }],
        ['GET', '/api/auth/tokens', undefined],
        ['POST', '/api/ingestor/simulate/huggingface', {}],
      ]) {
        const { status } = await call(method, path, { key: READ_KEY, body });
        assert.equal(status, 401, `${method} ${path} must stay closed to the read key, got ${status}`);
      }
    });

    await t.test('write key: full model lifecycle over HTTP', async () => {
      const whoami = await call('GET', '/api/auth/whoami', { key: WRITE_KEY });
      assert.deepEqual(whoami.body, { role: 'read-write', openAccess: false });

      const created = await call('POST', '/api/models', { key: WRITE_KEY, body: MODEL_PAYLOAD });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.ok(created.body.blockIndex >= 1);

      const duplicate = await call('POST', '/api/models', { key: WRITE_KEY, body: MODEL_PAYLOAD });
      assert.equal(duplicate.status, 400, 'duplicate registration must be rejected before touching the chain');

      const inferenceUnknown = await call('POST', '/api/inferences', {
        key: WRITE_KEY,
        body: { modelId: 'never-registered', inferenceId: 'inf-0', inputHash: HASH_A, outputHash: HASH_B },
      });
      assert.equal(inferenceUnknown.status, 404);

      const inference = await call('POST', '/api/inferences', {
        key: WRITE_KEY,
        body: { modelId: MODEL_PAYLOAD.modelId, inferenceId: 'inf-1', inputHash: HASH_A, outputHash: HASH_B },
      });
      assert.equal(inference.status, 200, JSON.stringify(inference.body));

      const patched = await call('PATCH', `/api/models/${MODEL_PAYLOAD.modelId}/status`, {
        key: WRITE_KEY,
        body: { status: 'deprecated' },
      });
      assert.equal(patched.status, 200);

      const verify = await call('GET', '/api/verify', { key: WRITE_KEY });
      assert.equal(verify.body.isValid, true, 'chain must verify after the lifecycle');
      assert.deepEqual(verify.body.errors, []);
      assert.ok(verify.body.blocksVerified >= 3, 'verify reports how many blocks it checked');
    });

    await t.test('issued token lifecycle: create, use, revoke, rejected', async () => {
      const issued = await call('POST', '/api/auth/tokens', {
        key: WRITE_KEY,
        body: { label: 'Auditor - HTTP Matrix', role: 'read-only', expiresInDays: 1 },
      });
      assert.equal(issued.status, 201);
      assert.match(issued.body.token, /^ernest_ro_/);

      const whoami = await call('GET', '/api/auth/whoami', { key: issued.body.token });
      assert.deepEqual(whoami.body, { role: 'read-only', openAccess: false, label: 'Auditor - HTTP Matrix' });

      assert.equal((await call('GET', '/api/models', { key: issued.body.token })).status, 200);
      assert.equal(
        (await call('POST', '/api/models', { key: issued.body.token, body: MODEL_PAYLOAD })).status,
        401,
        'a read-only token must not write',
      );

      const revoked = await call('DELETE', `/api/auth/tokens/${issued.body.id}`, { key: WRITE_KEY });
      assert.equal(revoked.status, 200);

      const afterRevoke = await call('GET', '/api/auth/whoami', { key: issued.body.token });
      assert.deepEqual(afterRevoke.body, { role: 'anonymous', openAccess: false });
      assert.equal((await call('GET', '/api/models', { key: issued.body.token })).status, 401);
    });
    await t.test('signed submission lifecycle (ADR-001): register key, sign, verify, revoke', async () => {
      const { generateKeyPairSync, createHash, sign: cryptoSign } = require('node:crypto');
      const { signedBytes } = require('../dist/common/signing.util');

      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const spki = publicKey.export({ format: 'der', type: 'spki' });
      const raw = spki.subarray(spki.length - 32);
      const publicKeyB64 = raw.toString('base64');
      const keyId = createHash('sha256').update(raw).digest('hex').slice(0, 16);

      const registered = await call('POST', '/api/auth/emitters', {
        key: WRITE_KEY,
        body: { label: 'HTTP matrix pipeline', publicKey: publicKeyB64 },
      });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
      assert.equal(registered.body.keyId, keyId);

      const payload = {
        type: 'model_registration',
        modelId: 'it-signed-model-v1',
        modelName: 'Signed Matrix Model',
        version: '1.0.0',
        modelHash: HASH_A,
        gitCommit: GIT_COMMIT,
      };
      const envelope = (sig) => ({
        alg: 'ed25519', keyId, publicKey: publicKeyB64,
        signedAt: new Date().toISOString(),
        sig: sig.toString('base64'),
      });
      const goodSig = cryptoSign(null, signedBytes(payload), privateKey);

      // Invalid signature: rejected before anything is stored.
      const badBody = {
        modelId: payload.modelId, modelName: payload.modelName, version: payload.version,
        mlflow: { modelHash: HASH_A, gitCommit: GIT_COMMIT },
        signature: envelope(Buffer.from(goodSig).fill(0, 0, 8)),
      };
      assert.equal((await call('POST', '/api/models', { key: WRITE_KEY, body: badBody })).status, 401);

      // Valid signature: accepted, envelope embedded in the block.
      const goodBody = { ...badBody, signature: envelope(goodSig) };
      const created = await call('POST', '/api/models', { key: WRITE_KEY, body: goodBody });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const block = await call('GET', `/api/blocks/${created.body.blockIndex}`, { key: READ_KEY });
      assert.equal(block.body.data.signature.keyId, keyId, 'block must embed the emitter signature');

      // Revoked key: a fresh, fully-distinct model (unique name+id so it doesn't trip
      // the duplicate-name guard first) signed by the revoked key is rejected at admission.
      assert.equal((await call('DELETE', `/api/auth/emitters/${keyId}`, { key: WRITE_KEY })).status, 200);
      const payload2 = { ...payload, modelId: 'it-signed-model-v2', modelName: 'Signed Matrix Model v2' };
      const body2 = {
        modelId: payload2.modelId, modelName: payload2.modelName, version: payload2.version,
        mlflow: { modelHash: HASH_A, gitCommit: GIT_COMMIT },
        signature: envelope(cryptoSign(null, signedBytes(payload2), privateKey)),
      };
      const afterRevoke = await call('POST', '/api/models', { key: WRITE_KEY, body: body2 });
      assert.equal(afterRevoke.status, 401, 'revoked emitter key must be rejected');
      assert.match(JSON.stringify(afterRevoke.body), /key_revoked/);
    });
  } finally {
    const connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await app.close();
  }
});
