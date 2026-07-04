const assert = require('node:assert/strict');
const test = require('node:test');
const { BlockchainService } = require('../dist/blockchain/blockchain.service');

function chainQuery(value) {
  return {
    sort: () => ({
      lean: () => {
        // Awaitable like a real lean() query, plus .cursor() for the streaming
        // verifyChain path.
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

function applyIndexFilter(blocks, filter = {}) {
  let result = [...blocks];
  if (filter.index?.$gte !== undefined) result = result.filter(b => b.index >= filter.index.$gte);
  if (filter.index?.$lte !== undefined) result = result.filter(b => b.index <= filter.index.$lte);
  return result.sort((a, b) => a.index - b.index);
}

function makeBlockModel(initialBlocks = []) {
  const blocks = [...initialBlocks];
  let failNextCreateWithDuplicate = false;

  return {
    blocks,
    failNextCreateWithDuplicate() {
      failNextCreateWithDuplicate = true;
    },
    findOne(filter = {}) {
      if (filter.index !== undefined) {
        return Promise.resolve(blocks.find(block => block.index === filter.index) || null);
      }

      const last = [...blocks].sort((a, b) => b.index - a.index)[0] || null;
      return chainQuery(last);
    },
    find(filter = {}) {
      return chainQuery(applyIndexFilter(blocks, filter));
    },
    async updateOne(filter, update, options) {
      const existing = blocks.find(block => block.index === filter.index);
      if (!existing && options?.upsert) {
        blocks.push(update.$setOnInsert);
        return { upsertedCount: 1 };
      }
      return { upsertedCount: 0 };
    },
    async create(block) {
      if (failNextCreateWithDuplicate) {
        failNextCreateWithDuplicate = false;
        const competingBlock = {
          ...block,
          index: block.index,
          hash: `${block.hash.slice(0, -1)}0`,
        };
        blocks.push(competingBlock);
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }

      if (blocks.some(existing => existing.index === block.index || existing.hash === block.hash)) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }

      blocks.push(block);
      return block;
    },
    countDocuments: async () => blocks.length,
    distinct: async field => {
      if (field !== 'data.modelId') {
        return [];
      }
      return [...new Set(blocks.map(block => block.data?.modelId).filter(Boolean))];
    },
  };
}

function makeAnchorModel() {
  return {
    findOne: () => chainQuery(null),
    create: async anchor => anchor,
  };
}

function makeService(blockModel = makeBlockModel(), anchorModel = makeAnchorModel()) {
  return new BlockchainService(blockModel, anchorModel);
}

test('createGenesisBlock is idempotent and produces a verifiable chain', async () => {
  const blockModel = makeBlockModel();
  const service = makeService(blockModel);

  await service.createGenesisBlock();
  await service.createGenesisBlock();

  assert.equal(blockModel.blocks.length, 1);
  assert.equal(blockModel.blocks[0].index, 0);

  const verification = await service.verifyChain();
  assert.equal(verification.isValid, true);
  assert.deepEqual(verification.errors, []);
  assert.equal(verification.lastVerifiedIndex, 0);
});

test('verifyChain detects tampered block data', async () => {
  const blockModel = makeBlockModel();
  const service = makeService(blockModel);

  await service.createGenesisBlock();
  const block = await service.addBlock({
    type: 'model_registration',
    modelId: 'model-a',
    modelName: 'Model A',
    version: '1.0.0',
  });

  block.data.version = '2.0.0';

  const verification = await service.verifyChain();
  assert.equal(verification.isValid, false);
  assert.match(verification.errors.join('\n'), /Hash mismatch/);
});

test('verifyChain detects a broken previousHash link', async () => {
  const blockModel = makeBlockModel();
  const service = makeService(blockModel);

  await service.createGenesisBlock();
  await service.addBlock({
    type: 'model_registration',
    modelId: 'model-link',
    modelName: 'Model Link',
    version: '1.0.0',
  });
  await service.addBlock({
    type: 'inference',
    modelId: 'model-link',
    inferenceId: 'inference-link',
    inputHash: 'a'.repeat(64),
    outputHash: 'b'.repeat(64),
  });

  blockModel.blocks[2].previousHash = 'c'.repeat(64);

  const verification = await service.verifyChain();
  assert.equal(verification.isValid, false);
  assert.match(verification.errors.join('\n'), /Hashchain broken/);
});

test('addBlock retries when a duplicate index race is detected', async () => {
  const blockModel = makeBlockModel();
  const service = makeService(blockModel);

  await service.createGenesisBlock();
  blockModel.failNextCreateWithDuplicate();

  const block = await service.addBlock({
    type: 'model_registration',
    modelId: 'model-b',
    modelName: 'Model B',
    version: '1.0.0',
  });

  assert.equal(block.index, 2);
  assert.equal(block.previousHash, blockModel.blocks[1].hash);
});

test('verifyChain from a checkpoint verifies only the tail (and re-anchors on the checkpoint block)', async () => {
  const blockModel = makeBlockModel();
  const service = makeService(blockModel);
  await service.createGenesisBlock();
  for (let i = 1; i <= 5; i++) {
    await service.addBlock({ type: 'inference', modelId: `m${i}` });
  }

  // Lazy-tamper block 1: edit data but keep its stored hash. A full scan catches it...
  blockModel.blocks[1].data.modelId = 'tampered';
  const full = await service.verifyChain();
  assert.equal(full.isValid, false);
  assert.match(full.errors.join(' '), /Block 1: Hash mismatch/);

  // ...while an incremental pass from block 4 doesn't re-read that history: this is
  // the documented blind spot that the daily full scan exists to close.
  const incremental = await service.verifyChain(4);
  assert.equal(incremental.isValid, true);
  assert.equal(incremental.blocksVerified, 3); // blocks 3 (checkpoint), 4 and 5
  assert.equal(incremental.lastVerifiedIndex, 5);
  assert.equal(incremental.lastVerifiedHash, blockModel.blocks[5].hash);

  // But tampering the tail IS caught incrementally.
  blockModel.blocks[5].data.modelId = 'tampered-tail';
  const incrementalBad = await service.verifyChain(4);
  assert.equal(incrementalBad.isValid, false);
  assert.match(incrementalBad.errors.join(' '), /Block 5: Hash mismatch/);
});

test('verifyChain reports non-contiguous chains', async () => {
  const blockModel = makeBlockModel();
  const service = makeService(blockModel);
  await service.createGenesisBlock();
  for (let i = 1; i <= 3; i++) {
    await service.addBlock({ type: 'inference', modelId: `m${i}` });
  }
  blockModel.blocks.splice(2, 1); // remove block 2 entirely

  const result = await service.verifyChain();
  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /not contiguous/);
});

test('verifyLatestAnchorRoot reproduces a valid anchored root and flags a mismatch', async () => {
  const blockModel = makeBlockModel();
  let anchorDoc = null;
  const anchorModel = {
    findOne: () => ({ sort: () => ({ lean: async () => anchorDoc }) }),
    create: async a => a,
  };
  const service = new BlockchainService(blockModel, anchorModel);
  await service.createGenesisBlock();
  for (let i = 1; i <= 3; i++) {
    await service.addBlock({ type: 'inference', modelId: `m${i}` });
  }

  // No anchor: nothing to check.
  assert.deepEqual(await service.verifyLatestAnchorRoot(), { checked: false, ok: true });

  anchorDoc = {
    merkleRoot: await service.getMerkleRoot(2),
    lastBlockIndex: 2,
    status: 'confirmed',
    txHash: '0xabc',
  };
  const ok = await service.verifyLatestAnchorRoot();
  assert.deepEqual({ checked: ok.checked, ok: ok.ok }, { checked: true, ok: true });

  // Recompute-forward rewrite of anchored history: hashes change, root stops matching.
  blockModel.blocks[1].hash = 'f'.repeat(64);
  const bad = await service.verifyLatestAnchorRoot();
  assert.equal(bad.ok, false);
  assert.match(bad.error, /no longer reproducible/);
});
