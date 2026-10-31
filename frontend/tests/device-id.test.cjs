const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/lib/device-id.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
function load(storage, crypto) {
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => name === 'expo-crypto' ? crypto : storage });
  return exports.getDeviceId;
}
test('concurrent first requests share one persisted device identity', async () => {
  let writes = 0, generated = 0;
  const get = load({ getItem: async () => null, setItem: async () => { writes++; } },
    { randomUUID: () => `id-${++generated}` });
  const ids = await Promise.all(Array.from({length: 30}, () => get()));
  assert.equal(new Set(ids).size, 1);
  assert.equal(writes, 1);
  assert.equal(generated, 1);
});
test('existing identity is preserved', async () => {
  const get = load({ getItem: async () => 'saved-id', setItem: async () => assert.fail('must not write') },
    { randomUUID: () => assert.fail('must not regenerate') });
  assert.equal(await get(), 'saved-id');
});
test('failed persistence can be retried without caching an unsaved identity', async () => {
  let writes = 0;
  const get = load({ getItem: async () => null, setItem: async () => { if (++writes === 1) throw Error('disk failure'); } },
    { randomUUID: () => 'new-id' });
  await assert.rejects(get(), /disk failure/);
  assert.equal(await get(), 'new-id');
  assert.equal(writes, 2);
});
