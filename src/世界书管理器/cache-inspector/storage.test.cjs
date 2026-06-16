const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const { getPromptSnapshot, listCacheSummaries } = require('./storage.ts');

test('migrates legacy cache records without aborting on malformed rows', async () => {
  const stores = createStores({
    records: [
      {
        id: 'legacy-valid',
        timestamp: 30,
        status: 'completed',
        model: 'deepseek-v4',
        messages: [{ role: 'user', text: 'valid prompt', length: 12, hash: 'valid-hash' }],
        hitTokens: 4,
        missTokens: 6,
        totalCacheTokens: 10,
        hitRate: 0.4,
        outputTokens: 3,
        totalTokens: 13,
        rawUsage: { prompt_tokens: 10 },
        errorMessage: null,
      },
      {
        id: 'legacy-missing-messages',
        timestamp: 20,
        status: 'completed',
        model: 'old-model',
        messageCount: 7,
        promptChars: 99,
        hitTokens: 0,
        missTokens: 0,
        totalCacheTokens: 0,
      },
      {
        id: 'legacy-string-messages',
        timestamp: 10,
        status: 'completed',
        model: 'mixed-model',
        messages: ['raw text', { role: 'assistant', content: 'answer' }],
      },
      {
        timestamp: 40,
        status: 'completed',
        model: 'invalid-without-id',
        messages: [{ role: 'user', text: 'should be skipped', length: 17, hash: 'skip' }],
      },
    ],
  });
  globalThis.indexedDB = createIndexedDbMock(stores);

  try {
    const summaries = await listCacheSummaries();
    assert.deepEqual(
      summaries.map(record => record.id),
      ['legacy-valid', 'legacy-missing-messages', 'legacy-string-messages'],
    );
    assert.equal(summaries[0].snapshotAvailable, true);
    assert.equal(summaries[1].snapshotAvailable, false);
    assert.equal(summaries[1].messageCount, 7);
    assert.equal(summaries[1].promptChars, 99);
    assert.equal(summaries[2].messageCount, 2);
    assert.equal(summaries[2].promptChars, 'raw text'.length + 'answer'.length);

    const validSnapshot = await getPromptSnapshot('legacy-valid');
    assert.equal(validSnapshot?.messages[0]?.text, 'valid prompt');

    const missingSnapshot = await getPromptSnapshot('legacy-missing-messages');
    assert.equal(missingSnapshot, null);

    const stringSnapshot = await getPromptSnapshot('legacy-string-messages');
    assert.equal(stringSnapshot?.messages[0]?.role, 'unknown');
    assert.equal(stringSnapshot?.messages[0]?.text, 'raw text');
    assert.equal(typeof stringSnapshot?.messages[0]?.hash, 'string');
    assert.equal(stringSnapshot?.messages[1]?.role, 'assistant');
    assert.equal(stringSnapshot?.messages[1]?.text, 'answer');
  } finally {
    delete globalThis.indexedDB;
  }
});

function createStores(seed) {
  return Object.fromEntries(
    Object.entries(seed).map(([storeName, records]) => [
      storeName,
      new Map(records.map((record, index) => [record.id ?? `missing-id-${index}`, structuredClone(record)])),
    ]),
  );
}

function createIndexedDbMock(stores) {
  const db = {
    objectStoreNames: {
      contains: storeName => storeName in stores,
    },
    createObjectStore: storeName => {
      stores[storeName] ??= new Map();
      return createObjectStore(stores, storeName);
    },
    transaction: storeNames => createTransaction(stores, Array.isArray(storeNames) ? storeNames : [storeNames]),
    close: () => {},
  };

  return {
    open: () => {
      const request = createOpenRequest(db);
      queueMicrotask(() => {
        request.result = db;
        request.transaction = createTransaction(stores, Object.keys(stores));
        request.onupgradeneeded?.();
        queueMicrotask(() => request.onsuccess?.());
      });
      return request;
    },
  };
}

function createTransaction(stores, storeNames) {
  return {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore: storeName => {
      if (!storeNames.includes(storeName)) throw new Error(`Store is not in transaction: ${storeName}`);
      return createObjectStore(stores, storeName);
    },
    abort: () => {},
  };
}

function createObjectStore(stores, storeName) {
  const store = stores[storeName];
  if (!store) throw new Error(`Unknown store: ${storeName}`);

  return {
    createIndex: () => {},
    indexNames: {
      contains: name => name === 'timestamp',
    },
    put: value => {
      if (!value?.id) throw new Error('Missing keyPath id');
      store.set(value.id, structuredClone(value));
      return createRequest(value.id);
    },
    get: id => createRequest(cloneValue(store.get(id))),
    getAll: () => createRequest(Array.from(store.values()).map(cloneValue)),
    clear: () => {
      store.clear();
      return createRequest(undefined);
    },
    delete: id => {
      store.delete(id);
      return createRequest(undefined);
    },
  };
}

function createOpenRequest(db) {
  return {
    result: db,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    transaction: null,
  };
}

function createRequest(result) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}
