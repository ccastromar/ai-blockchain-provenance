// OTS anchoring provider: stamping produces a pending anchor carrying the proof,
// the upgrade cycle confirms it once a Bitcoin attestation appears, and receipts
// expose the proof URL so auditors can verify with the official ots client. The
// real calendar network is exercised separately (see ots.client.ts and the release
// checklist); here the client is faked to pin the lifecycle logic.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const { BlockchainService } = require('../dist/blockchain/blockchain.service');

function chainQuery(value) {
  return {
    sort: () => ({
      lean: () => {
        const promise = Promise.resolve(value);
        promise.cursor = () => ({
          async *[Symbol.asyncIterator]() {
            for (const item of Array.isArray(value) ? value : []) yield item;
          },
        });
        return promise;
      },
    }),
  };
}

function makeChain(n) {
  const blocks = [];
  let prev = '0';
  for (let i = 0; i < n; i++) {
    const hash = createHash('sha256').update(`ots-test-${i}-${prev}`).digest('hex');
    blocks.push({ index: i, timestamp: 1700000000 + i, data: { type: 'inference', modelId: `m${i}` }, previousHash: prev, hash });
    prev = hash;
  }
  return blocks;
}

function blockModelFor(blocks) {
  return {
    findOne(filter = {}) {
      if (filter.index !== undefined && typeof filter.index !== 'object') {
        return { lean: async () => blocks.find(b => b.index === filter.index) || null };
      }
      const last = [...blocks].sort((a, b) => b.index - a.index)[0] || null;
      return chainQuery(last);
    },
    find(filter = {}) {
      let result = [...blocks];
      if (filter.index?.$lte !== undefined) result = result.filter(b => b.index <= filter.index.$lte);
      return chainQuery(result.sort((a, b) => a.index - b.index));
    },
    countDocuments: async () => blocks.length,
  };
}

function anchorModelStore() {
  const docs = [];
  return {
    docs,
    async create(doc) {
      const created = { ...doc, _id: `anchor-${docs.length}`, status: doc.status ?? 'pending' };
      docs.push(created);
      return created;
    },
    find(filter = {}) {
      let result = docs.filter(d => (filter.provider ? d.provider === filter.provider : true));
      if (filter.status) result = result.filter(d => d.status === filter.status);
      return { lean: async () => result };
    },
    findOne(filter = {}) {
      let result = docs.filter(d => (filter.provider ? d.provider === filter.provider : true));
      if (filter.status) result = result.filter(d => d.status === filter.status);
      if (filter._id) result = result.filter(d => d._id === filter._id);
      if (filter.lastBlockIndex?.$gte !== undefined) result = result.filter(d => d.lastBlockIndex >= filter.lastBlockIndex.$gte);
      const sortable = [...result];
      return {
        lean: async () => sortable[0] || null,
        sort: (spec = {}) => ({
          lean: async () => {
            const [[key, dir]] = Object.entries(spec);
            sortable.sort((a, b) => (a[key] - b[key]) * dir);
            return sortable[0] || null;
          },
        }),
      };
    },
    async updateOne(filter, update) {
      const doc = docs.find(d => d._id === filter._id);
      if (doc) Object.assign(doc, update.$set);
      return { modifiedCount: doc ? 1 : 0 };
    },
    countDocuments: async (filter = {}) =>
      docs.filter(d => (!filter.provider || d.provider === filter.provider) && (!filter.status || d.status === filter.status)).length,
  };
}

function fakeOts() {
  const calls = { stamped: [], upgraded: 0 };
  let completeNext = false;
  return {
    calls,
    completeNextUpgrade() { completeNext = true; },
    async stamp(rootHex) {
      calls.stamped.push(rootHex);
      return Buffer.from(`pending-proof-for-${rootHex}`).toString('base64');
    },
    async upgrade(proofBase64) {
      calls.upgraded += 1;
      if (completeNext) {
        return { complete: true, proofBase64: Buffer.from('upgraded').toString('base64'), bitcoinBlockHeight: 903123 };
      }
      return { complete: false, proofBase64 };
    },
  };
}

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test('ANCHOR_PROVIDER=ots enables anchoring without any EVM configuration', () =>
  withEnv({ ANCHOR_PROVIDER: 'ots', INFURA_URL: undefined, PRIVATE_KEY: undefined, CONTRACT_ADDRESS: undefined }, async () => {
    const service = new BlockchainService(blockModelFor(makeChain(3)), anchorModelStore(), fakeOts());
    assert.equal(service.getAnchorProvider(), 'ots');
  }));

test('OTS anchoring stamps the bounded root and stores a pending anchor with the proof', () =>
  withEnv({ ANCHOR_PROVIDER: 'ots' }, async () => {
    const blocks = makeChain(4);
    const anchors = anchorModelStore();
    const ots = fakeOts();
    const service = new BlockchainService(blockModelFor(blocks), anchors, ots);

    const result = await service.anchorMerkleRootToOts();

    assert.equal(result.provider, 'ots');
    assert.equal(result.status, 'pending');
    assert.equal(result.lastBlockIndex, 3);
    assert.match(result.otsProofUrl, /^\/api\/anchors\/anchor-0\/ots$/);

    const expectedRoot = '0x' + new MerkleTree(blocks.map(b => Buffer.from(b.hash, 'hex')), keccak256, { sortPairs: true }).getRoot().toString('hex');
    assert.deepEqual(ots.calls.stamped, [expectedRoot]);
    assert.equal(anchors.docs[0].otsProof, Buffer.from(`pending-proof-for-${expectedRoot}`).toString('base64'));
  }));

test('upgrade cycle confirms the anchor once a Bitcoin attestation appears', () =>
  withEnv({ ANCHOR_PROVIDER: 'ots' }, async () => {
    const anchors = anchorModelStore();
    const ots = fakeOts();
    const service = new BlockchainService(blockModelFor(makeChain(4)), anchors, ots);
    await service.anchorMerkleRootToOts();

    let cycle = await service.upgradePendingOtsAnchors();
    assert.deepEqual(cycle, { upgraded: 0, pending: 1 }, 'still pending before aggregation');
    assert.equal(anchors.docs[0].status, 'pending');

    ots.completeNextUpgrade();
    cycle = await service.upgradePendingOtsAnchors();
    assert.deepEqual(cycle, { upgraded: 1, pending: 0 });
    assert.equal(anchors.docs[0].status, 'confirmed');
    assert.equal(anchors.docs[0].bitcoinBlockHeight, 903123);
  }));

test('a receipt covered by a confirmed OTS anchor carries provider, height and proof URL', () =>
  withEnv({ ANCHOR_PROVIDER: 'ots' }, async () => {
    const blocks = makeChain(4);
    const anchors = anchorModelStore();
    const ots = fakeOts();
    const service = new BlockchainService(blockModelFor(blocks), anchors, ots);
    await service.anchorMerkleRootToOts();
    ots.completeNextUpgrade();
    await service.upgradePendingOtsAnchors();

    const receipt = await service.getBlockProof(2);
    assert.equal(receipt.anchor.provider, 'ots');
    assert.equal(receipt.anchor.bitcoinBlockHeight, 903123);
    assert.equal(receipt.anchor.otsProofUrl, '/api/anchors/anchor-0/ots');
  }));

test('getOtsProof returns the raw proof bytes for the official verifier', () =>
  withEnv({ ANCHOR_PROVIDER: 'ots' }, async () => {
    const anchors = anchorModelStore();
    const service = new BlockchainService(blockModelFor(makeChain(2)), anchors, fakeOts());
    await service.anchorMerkleRootToOts();

    const result = await service.getOtsProof('anchor-0');
    assert.ok(result.proof.toString().startsWith('pending-proof-for-0x'));
    assert.equal(await service.getOtsProof('nope'), null);
  }));
