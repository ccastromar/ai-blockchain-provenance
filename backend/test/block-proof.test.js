// Inclusion-receipt tests: getBlockProof must emit proofs that verify against the
// anchored root, pick the EARLIEST covering anchor, and refuse to emit receipts when
// the local chain can no longer reproduce what was anchored (that refusal IS the
// tamper evidence).
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const { BlockchainService } = require('../dist/blockchain/blockchain.service');

function makeChain(n) {
  const blocks = [];
  let prev = '0';
  for (let i = 0; i < n; i++) {
    const hash = createHash('sha256').update(`proof-test-block-${i}-${prev}`).digest('hex');
    blocks.push({ index: i, timestamp: 1700000000 + i, data: { type: 'inference', modelId: `m${i}` }, previousHash: prev, hash });
    prev = hash;
  }
  return blocks;
}

function rootOf(blocks, upToIndex) {
  const leaves = blocks.filter(b => b.index <= upToIndex).map(b => Buffer.from(b.hash, 'hex'));
  return '0x' + new MerkleTree(leaves, keccak256, { sortPairs: true }).getRoot().toString('hex');
}

function fakeBlockModel(blocks) {
  return {
    findOne(filter = {}) {
      if (filter.index !== undefined && typeof filter.index !== 'object') {
        const found = blocks.find(b => b.index === filter.index) || null;
        return { lean: async () => found };
      }
      const last = [...blocks].sort((a, b) => b.index - a.index)[0] || null;
      return { sort: () => ({ lean: async () => last }) };
    },
    find(filter = {}) {
      let result = [...blocks];
      if (filter.index?.$lte !== undefined) result = result.filter(b => b.index <= filter.index.$lte);
      result.sort((a, b) => a.index - b.index);
      return { sort: () => ({ lean: async () => result }) };
    },
  };
}

function fakeAnchorModel(anchors) {
  return {
    findOne(filter = {}) {
      let result = [...anchors];
      if (filter.status) result = result.filter(a => a.status === filter.status);
      if (filter.lastBlockIndex?.$gte !== undefined) result = result.filter(a => a.lastBlockIndex >= filter.lastBlockIndex.$gte);
      return {
        sort: (spec = {}) => ({
          lean: async () => {
            const [[key, dir]] = Object.entries(spec);
            result.sort((a, b) => (a[key] - b[key]) * dir);
            return result[0] || null;
          },
        }),
      };
    },
  };
}

const CHAIN = makeChain(9);
const ANCHOR_AT_4 = {
  merkleRoot: rootOf(CHAIN, 4), lastBlockIndex: 4, status: 'confirmed',
  txHash: '0xaaa', blockNumber: 100, chainId: 11155111, contractAddress: '0xc0ffee',
  organizationId: 'org-test', anchoredAt: new Date('2026-07-01T00:00:00Z'),
};
const ANCHOR_AT_8 = {
  merkleRoot: rootOf(CHAIN, 8), lastBlockIndex: 8, status: 'confirmed',
  txHash: '0xbbb', blockNumber: 200, chainId: 11155111, contractAddress: '0xc0ffee',
  organizationId: 'org-test', anchoredAt: new Date('2026-07-02T00:00:00Z'),
};

test('emits a proof that verifies against the anchored root', async () => {
  const service = new BlockchainService(fakeBlockModel(CHAIN), fakeAnchorModel([ANCHOR_AT_4, ANCHOR_AT_8]));
  const receipt = await service.getBlockProof(2);

  assert.equal(receipt.merkleRoot, ANCHOR_AT_4.merkleRoot, 'must use the EARLIEST covering anchor');
  assert.equal(receipt.anchor.txHash, '0xaaa');
  assert.equal(receipt.hashAlgorithm, 'keccak256');
  assert.equal(receipt.pairSorting, 'sorted');

  const leaves = CHAIN.slice(0, 5).map(b => Buffer.from(b.hash, 'hex'));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const proofBuffers = receipt.proof.map(p => Buffer.from(p.replace(/^0x/, ''), 'hex'));
  assert.ok(
    tree.verify(proofBuffers, Buffer.from(receipt.block.hash, 'hex'), Buffer.from(receipt.merkleRoot.replace(/^0x/, ''), 'hex')),
    'proof must verify against the anchored root',
  );
});

test('a block covered only by the later anchor uses that root', async () => {
  const service = new BlockchainService(fakeBlockModel(CHAIN), fakeAnchorModel([ANCHOR_AT_4, ANCHOR_AT_8]));
  const receipt = await service.getBlockProof(7);
  assert.equal(receipt.merkleRoot, ANCHOR_AT_8.merkleRoot);
  assert.equal(receipt.anchor.txHash, '0xbbb');
});

test('returns null for a missing block', async () => {
  const service = new BlockchainService(fakeBlockModel(CHAIN), fakeAnchorModel([ANCHOR_AT_8]));
  assert.equal(await service.getBlockProof(999), null);
});

test('refuses when no confirmed anchor covers the block', async () => {
  const service = new BlockchainService(fakeBlockModel(CHAIN), fakeAnchorModel([ANCHOR_AT_4]));
  await assert.rejects(() => service.getBlockProof(7), /not covered by a confirmed anchor/);
});

test('refuses when the local chain cannot reproduce the anchored root', async () => {
  const tampered = CHAIN.map(b => (b.index === 3 ? { ...b, hash: 'f'.repeat(64) } : b));
  const service = new BlockchainService(fakeBlockModel(tampered), fakeAnchorModel([ANCHOR_AT_4]));
  await assert.rejects(() => service.getBlockProof(2), /does not reproduce anchored Merkle root/);
});

test('golden fixture roots are reproduced by the same construction', () => {
  const fixture = require('../../testdata/merkle-proof-golden.json');
  for (const c of fixture.cases) {
    const leaves = c.blockHashes.map(h => Buffer.from(h, 'hex'));
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    assert.equal('0x' + tree.getRoot().toString('hex'), c.merkleRoot, `case ${c.name}`);
    for (const p of c.proofs) {
      const proofBuffers = p.proof.map(x => Buffer.from(x.replace(/^0x/, ''), 'hex'));
      assert.ok(
        tree.verify(proofBuffers, Buffer.from(p.blockHash, 'hex'), Buffer.from(c.merkleRoot.replace(/^0x/, ''), 'hex')),
        `case ${c.name} proof for block ${p.blockIndex}`,
      );
    }
  }
});
