const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { load: loadYaml } = require('js-yaml');
const { GovernanceModel, GovernanceModelError, governanceModel } = require('../dist/governance/governance-model');

// The governance contract's test vectors (src/governance/contract/vectors), run against Ernest.
const CONTRACT = join(__dirname, '..', 'src', 'governance', 'contract');
const VECTORS = join(CONTRACT, 'vectors');
const readJson = (name) => JSON.parse(readFileSync(join(VECTORS, name), 'utf8'));
const modelOf = (spec) => (spec.file ? loadYaml(readFileSync(join(VECTORS, spec.file), 'utf8')) : spec.inline);

// RFC 7386 JSON Merge Patch: objects merge, null removes, anything else replaces.
function mergePatch(target, patch) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const result = typeof target === 'object' && target !== null && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

const resolution = readJson('resolution.json');
const models = Object.fromEntries(
  Object.entries(resolution.models).map(([name, spec]) => [name, GovernanceModel.of(modelOf(spec))]),
);
for (const c of resolution.cases) {
  test(`resolution: ${c.name}`, () => {
    assert.deepEqual(models[c.model].resolve(c.claims, c.app), c.expect);
  });
}

const validation = readJson('validation.json');
for (const c of validation.cases) {
  test(`validation: ${c.name}`, () => {
    const model = c.model ? modelOf(c.model) : mergePatch(validation.base, c.patch);
    if (c.valid) {
      GovernanceModel.of(model);
    } else {
      assert.throws(
        () => GovernanceModel.of(model),
        (err) => err instanceof GovernanceModelError && err.code === c.error,
      );
    }
  });
}

test('the default model ships next to the build', () => {
  assert.deepEqual(governanceModel().resolve({ roles: ['ernest-reader'] }, 'ernest'), ['audit']);
});

test('the contract is the copy synced from prudence-governance', () => {
  const lines = readFileSync(join(CONTRACT, 'SOURCE'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const [sum, name] = line.split('  ');
    const actual = createHash('sha256').update(readFileSync(join(CONTRACT, name))).digest('hex');
    assert.equal(actual, sum, `src/governance/contract/${name} was edited: change the contract in prudence-governance and run its sync.sh`);
  }
});
