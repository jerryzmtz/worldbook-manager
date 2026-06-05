const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const {
  DUPLICATE_WORLDBOOK_ALGORITHM_VERSION,
  createWorldbookContentFingerprint,
  parseWorldbookVersionName,
} = require('./duplicate-worldbook.ts');
const {
  clearDedupeCache,
  createDedupeComparisonCache,
  getDedupeCacheStats,
  getDedupeFingerprintCache,
  saveDedupeFingerprintCacheRecords,
} = require('./duplicate-worldbook-cache.ts');

let stores;
let originalIndexedDb;

beforeEach(async () => {
  originalIndexedDb = globalThis.indexedDB;
  stores = {
    fingerprints: new Map(),
    comparisons: new Map(),
  };
  globalThis.indexedDB = createIndexedDbMock(stores);
  await clearDedupeCache();
});

afterEach(() => {
  if (originalIndexedDb === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDb;
  stores = undefined;
  originalIndexedDb = undefined;
});

test('fingerprint cache hits by source hash and ignores stale source hash', async () => {
  const fingerprint = createWorldbookContentFingerprint([entry('身份', longContent('身份'))]);
  await saveDedupeFingerprintCacheRecords([
    {
      name: '缓存测试世界书',
      sourceHash: 'hash-a',
      versionInfo: parseWorldbookVersionName('缓存测试世界书'),
      fingerprint,
      importedAt: 100,
      modifiedAt: 200,
      loadedAt: 300,
    },
  ]);

  const hit = await getDedupeFingerprintCache('缓存测试世界书', 'hash-a');
  const miss = await getDedupeFingerprintCache('缓存测试世界书', 'hash-b');

  assert.equal(hit?.fingerprint.contentHash, fingerprint.contentHash);
  assert.equal(hit?.modifiedAt, 200);
  assert.equal(miss, null);
});

test('fingerprint cache ignores old algorithm versions', async () => {
  const fingerprint = createWorldbookContentFingerprint([entry('设定', longContent('设定'))]);
  await saveDedupeFingerprintCacheRecords([
    {
      name: '旧算法缓存世界书',
      sourceHash: 'hash-old',
      versionInfo: parseWorldbookVersionName('旧算法缓存世界书'),
      fingerprint,
      importedAt: null,
      modifiedAt: null,
      loadedAt: 300,
    },
  ]);
  stores.fingerprints.get('旧算法缓存世界书').algorithmVersion = 'old-version';

  const cached = await getDedupeFingerprintCache('旧算法缓存世界书', 'hash-old');

  assert.equal(cached, null);
});

test('comparison cache stores reusable small comparison records and can be cleared', async () => {
  const cache = createDedupeComparisonCache();
  const comparison = {
    similarity: 0.8,
    leftCoverage: 0.9,
    rightCoverage: 0.7,
    smallerCoverage: 0.9,
    overlap: 3,
    union: 4,
    textSimilarity: 0.75,
    contentLeftCoverage: 0.9,
    contentRightCoverage: 0.7,
    contentSmallerCoverage: 0.9,
    matchedLeftEntries: 3,
    matchedRightEntries: 2,
    matchedEntryCount: 3,
    exact: false,
    sameFamily: true,
  };

  assert.equal(await cache.get('same:a:b'), null);
  await cache.set('same:a:b', comparison);
  assert.deepEqual(await cache.get('same:a:b'), comparison);

  const statsBeforeClear = await getDedupeCacheStats();
  assert.equal(statsBeforeClear.comparisonCount, 1);

  await clearDedupeCache();
  const statsAfterClear = await getDedupeCacheStats();
  assert.equal(statsAfterClear.fingerprintCount, 0);
  assert.equal(statsAfterClear.comparisonCount, 0);
});

test('cache records use the current algorithm version', async () => {
  const fingerprint = createWorldbookContentFingerprint([entry('版本', longContent('版本'))]);
  await saveDedupeFingerprintCacheRecords([
    {
      name: '版本号缓存世界书',
      sourceHash: 'hash-version',
      versionInfo: parseWorldbookVersionName('版本号缓存世界书'),
      fingerprint,
      importedAt: null,
      modifiedAt: null,
      loadedAt: 300,
    },
  ]);

  assert.equal(stores.fingerprints.get('版本号缓存世界书').algorithmVersion, DUPLICATE_WORLDBOOK_ALGORITHM_VERSION);
});

function createIndexedDbMock(backingStores) {
  return {
    open() {
      const request = {};
      setTimeout(() => {
        const db = createDatabase(backingStores);
        request.result = db;
        request.transaction = createTransaction(backingStores, Object.keys(backingStores));
        request.onupgradeneeded?.();
        setTimeout(() => request.onsuccess?.(), 0);
      }, 0);
      return request;
    },
  };
}

function createDatabase(backingStores) {
  return {
    objectStoreNames: {
      contains: storeName => storeName in backingStores,
    },
    createObjectStore(storeName) {
      if (!(storeName in backingStores)) backingStores[storeName] = new Map();
      return createObjectStore(backingStores[storeName], createTransaction(backingStores, [storeName]));
    },
    transaction(storeNames) {
      return createTransaction(backingStores, Array.isArray(storeNames) ? storeNames : [storeNames]);
    },
    close() {},
  };
}

function createTransaction(backingStores, storeNames) {
  const transaction = {
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null,
    pending: 0,
    completed: false,
    objectStore(storeName) {
      if (!storeNames.includes(storeName)) throw new Error(`Store not in transaction: ${storeName}`);
      if (!(storeName in backingStores)) backingStores[storeName] = new Map();
      return createObjectStore(backingStores[storeName], transaction);
    },
    abort() {
      transaction.error = new Error('Transaction aborted');
      transaction.onabort?.();
    },
  };
  scheduleTransactionComplete(transaction);
  return transaction;
}

function createObjectStore(store, transaction) {
  return {
    createIndex() {},
    get(key) {
      return requestWithTransaction(transaction, () => store.get(key));
    },
    getAll() {
      return requestWithTransaction(transaction, () => [...store.values()]);
    },
    put(value) {
      return requestWithTransaction(transaction, () => {
        const key = value.name ?? value.id;
        store.set(key, value);
        return key;
      });
    },
    delete(key) {
      return requestWithTransaction(transaction, () => {
        store.delete(key);
        return undefined;
      });
    },
    clear() {
      return requestWithTransaction(transaction, () => {
        store.clear();
        return undefined;
      });
    },
    count() {
      return requestWithTransaction(transaction, () => store.size);
    },
  };
}

function requestWithTransaction(transaction, producer) {
  const request = {};
  transaction.pending += 1;
  setTimeout(() => {
    try {
      request.result = producer();
      request.onsuccess?.();
    } catch (error) {
      request.error = error;
      transaction.error = error;
      request.onerror?.();
      transaction.onerror?.();
    } finally {
      transaction.pending -= 1;
      scheduleTransactionComplete(transaction);
    }
  }, 0);
  return request;
}

function scheduleTransactionComplete(transaction) {
  setTimeout(() => {
    if (transaction.pending > 0 || transaction.completed || transaction.error) return;
    transaction.completed = true;
    transaction.oncomplete?.();
  }, 0);
}

function entry(name, content = name) {
  return {
    name,
    enabled: true,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: {
      type: 'before_character_definition',
      role: 'system',
      depth: 0,
      order: 100,
    },
    content,
    probability: 100,
    recursion: {
      prevent_incoming: false,
      prevent_outgoing: false,
      delay_until: null,
    },
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
  };
}

function longContent(label) {
  return `${label}${label}${label}：这是一段足够长的世界书条目正文，用来测试智能去重缓存。`;
}
