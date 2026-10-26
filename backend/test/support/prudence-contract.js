// Ernest's side of its contract with Prudence (contracts/prudence-evidence/, copied from
// prudence-governance contract/ernest by its sync.sh): boots the real AppModule in one batching
// mode, replays every interaction of one file in order and checks each answer has the status and
// the fields Prudence reads (README.md there). Prudence runs the same interactions against its
// own adapters. Used by prudence-contract.test.js (on) and prudence-contract-unbatched.test.js.
//
// Requires a reachable MongoDB, like http-auth-matrix.test.js; uses a throwaway database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MONGO_HOST = process.env.HTTP_TEST_MONGO_HOST || '127.0.0.1';
const MONGO_PORT = Number(process.env.HTTP_TEST_MONGO_PORT || 27017);
const KEY = 'contract-write-key';
const CONTRACT = path.join(__dirname, '..', 'contracts', 'prudence-evidence');

function mongoReachable() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: MONGO_HOST, port: MONGO_PORT, timeout: 1500 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// Every field of the example is in the answer, with the same JSON type; arrays: every element
// matches the example's first. Fields Prudence does not read may be added freely.
function missing(example, actual, at = '$', out = []) {
  if (kind(example) !== kind(actual)) {
    out.push(`${at} is ${kind(actual)}, Prudence reads ${kind(example)}`);
  } else if (kind(example) === 'object') {
    for (const [k, v] of Object.entries(example)) {
      if (!(k in actual)) out.push(`${at}.${k} missing`);
      else missing(v, actual[k], `${at}.${k}`, out);
    }
  } else if (kind(example) === 'array' && example.length) {
    if (!actual.length) out.push(`${at} is empty`);
    actual.forEach((item, i) => missing(example[Math.min(i, example.length - 1)], item, `${at}[${i}]`, out));
  }
  return out;
}

// What Prudence relies on in one answer (README.md, "Matching"); an empty list means it holds.
function check(want, got) {
  const out = [];
  const statuses = [].concat(want.status);
  if (!statuses.includes(got.status)) out.push(`status ${got.status}, Prudence expects ${statuses.join(' or ')}`);
  if (want.body !== undefined) missing(want.body, got.json, '$', out);
  for (const field of want.equal || []) {
    if (JSON.stringify(got.json?.[field]) !== JSON.stringify(want.body[field])) out.push(`$.${field} is not ${JSON.stringify(want.body[field])}`);
  }
  for (const [where, allowed] of Object.entries(want.oneOf || {})) {
    const [list, field] = where.split('[].');
    for (const item of got.json?.[list] || []) {
      if (!allowed.includes(item[field])) out.push(`$.${list}[].${field} ${item[field]} not in ${allowed}`);
    }
  }
  if (want.contains && !got.text.includes(want.contains)) out.push(`answer lacks "${want.contains}"`);
  return out;
}

async function verifyPrudenceContract(t, { file, batching }) {
  if (!(await mongoReachable())) {
    t.skip(`MongoDB not reachable at ${MONGO_HOST}:${MONGO_PORT}`);
    return;
  }

  const contract = JSON.parse(fs.readFileSync(path.join(CONTRACT, file), 'utf8'));

  t.test('the copy is the one synced from prudence-governance', () => {
    const lines = fs.readFileSync(path.join(CONTRACT, 'SOURCE'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    assert.ok(lines.length > 0, 'SOURCE lists no files');
    for (const line of lines) {
      const [sum, name] = line.split('  ');
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(CONTRACT, name))).digest('hex');
      assert.equal(actual, sum, `${name} differs from the synced copy: change the contract in prudence-governance and run its sync.sh`);
    }
  });

  const dbName = `ernest_prudence_contract_${batching}_${process.pid}`;
  process.env.MONGODB_URI = `mongodb://${MONGO_HOST}:${MONGO_PORT}/${dbName}?serverSelectionTimeoutMS=3000`;
  process.env.ERNEST_API_KEY = KEY;
  delete process.env.ERNEST_READ_API_KEY;
  process.env.EVIDENCE_BATCHING = batching;
  process.env.BATCH_INTERVAL_MS = '100';
  delete process.env.WEBHOOK_URL;
  delete process.env.INFURA_URL;

  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { getConnectionToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../../dist/app.module');
  const { GlobalExceptionFilter } = require('../../dist/common/global.exception.filter');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(0);
  const base = await app.getUrl();

  const send = async ({ method, path: p, body }) => {
    const response = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Ernest-Api-Key': KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* no body */ }
    return { status: response.status, text, json };
  };

  try {
    for (const interaction of contract.interactions) {
      await t.test(interaction.id, async () => {
        const want = interaction.response;
        const statuses = [].concat(want.status);
        // `eventually`: the answer once Ernest has caught up (a batch chained), as Prudence
        // sees it when it asks again later.
        let got = await send(interaction.request);
        let problems = check(want, got);
        for (let i = 0; want.eventually && problems.length && i < 50; i++) {
          await new Promise((r) => setTimeout(r, 100));
          got = await send(interaction.request);
          problems = check(want, got);
        }
        if (process.env.CONTRACT_PRINT) console.log(`ANSWER ${interaction.id} ${got.status} ${got.text}`);
        assert.deepEqual(problems, [], `Ernest answered ${got.status} ${got.text}`);
      });
    }
  } finally {
    await app.get(getConnectionToken()).dropDatabase();
    await app.close();
  }
}

module.exports = { verifyPrudenceContract };
