'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Force the in-memory path — these tests must not touch a real MongoDB.
delete process.env.MONGODB_URI;
delete process.env.MONGODB_URI_FALLBACK;

const store = require('../lib/store.js');

test('storageMode falls back to memory without a MONGODB_URI', async () => {
  await store.init();
  assert.strictEqual(store.storageMode(), 'memory');
});

test('createDatasetIfAbsent: first call creates, a second call with the same id is a no-op', async () => {
  const id = 'test-fixed-id-1';
  const fields = { name: 'demo', headers: ['a'], rows: [['1'], ['2']], profile: { quality: { score: 90 } } };

  const first = await store.createDatasetIfAbsent(id, fields);
  assert.ok(first, 'first call should create the dataset');
  assert.strictEqual(first.id, id);

  // Simulates a second serverless instance racing to seed the same fixed id.
  const second = await store.createDatasetIfAbsent(id, { ...fields, name: 'should-be-ignored' });
  assert.strictEqual(second, null, 'losing the race should return null, not overwrite');

  const stored = await store.getDataset(id);
  assert.strictEqual(stored.name, 'demo', 'the winning insert\'s data must be left untouched');
});

test('createDataset (random id) never collides with itself across calls', async () => {
  const fields = { name: 'x', headers: ['a'], rows: [['1']], profile: { quality: { score: 100 } } };
  const a = await store.createDataset(fields);
  const b = await store.createDataset(fields);
  assert.notStrictEqual(a.id, b.id);
  assert.ok(await store.getDataset(a.id));
  assert.ok(await store.getDataset(b.id));
});
