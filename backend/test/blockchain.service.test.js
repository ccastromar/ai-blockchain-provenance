const assert = require('node:assert/strict');
const test = require('node:test');
const { BlockchainService } = require('../dist/blockchain/blockchain.service');

function chainQuery(value) {
  return {
    sort: () => ({
      lean: async () => value,
    }),
  };
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
    find() {
      return chainQuery([...blocks].sort((a, b) => a.index - b.index));
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
  assert.deepEqual(verification, { isValid: true, errors: [] });
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
