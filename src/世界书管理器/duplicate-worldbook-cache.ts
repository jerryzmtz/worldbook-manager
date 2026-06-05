import type {
  DuplicateWorldbookComparisonCache,
  DuplicateWorldbookContentFingerprint,
  DuplicateWorldbookPairComparison,
  WorldbookNameVersionInfo,
} from './duplicate-worldbook';
import { DUPLICATE_WORLDBOOK_ALGORITHM_VERSION } from './duplicate-worldbook';

const DB_NAME = 'WorldbookDedupeCacheDB';
const DB_VERSION = 1;
const FINGERPRINT_STORE = 'fingerprints';
const COMPARISON_STORE = 'comparisons';
const MAX_FINGERPRINT_RECORDS = 1000;
const MAX_COMPARISON_RECORDS = 100000;
const COMPARISON_PRUNE_INTERVAL = 250;

export type DedupeFingerprintCacheRecord = {
  name: string;
  algorithmVersion: string;
  sourceHash: string;
  versionInfo: WorldbookNameVersionInfo;
  fingerprint: DuplicateWorldbookContentFingerprint;
  importedAt: number | null;
  modifiedAt: number | null;
  loadedAt: number | null;
  cachedAt: number;
  lastUsedAt: number;
};

export type DedupeFingerprintCacheInput = Omit<
  DedupeFingerprintCacheRecord,
  'algorithmVersion' | 'cachedAt' | 'lastUsedAt'
>;

export type DedupeComparisonCacheRecord = {
  id: string;
  algorithmVersion: string;
  comparison: DuplicateWorldbookPairComparison;
  cachedAt: number;
  lastUsedAt: number;
};

export type DedupeCacheStats = {
  fingerprintCount: number;
  comparisonCount: number;
  memoryFallback: boolean;
};

export type DedupeComparisonCacheOptions = {
  onHit?: () => void;
};

const memoryFingerprints = new Map<string, DedupeFingerprintCacheRecord>();
const memoryComparisons = new Map<string, DedupeComparisonCacheRecord>();
let persistentUnavailable = false;
let comparisonWritesSincePrune = 0;

export function dedupeCacheUsesMemoryFallback(): boolean {
  return persistentUnavailable || !hasIndexedDb();
}

export async function getDedupeFingerprintCache(
  name: string,
  sourceHash: string,
): Promise<DedupeFingerprintCacheRecord | null> {
  const now = Date.now();
  if (dedupeCacheUsesMemoryFallback()) {
    return getMemoryFingerprint(name, sourceHash, now);
  }

  try {
    const record = await withStore<DedupeFingerprintCacheRecord | undefined>(
      FINGERPRINT_STORE,
      'readwrite',
      store => store.get(name),
      '读取智能去重缓存失败',
      (store, recordValue) => {
        if (isValidFingerprintRecord(recordValue, sourceHash)) {
          store.put({ ...recordValue, lastUsedAt: now });
        }
      },
    );
    if (!isValidFingerprintRecord(record, sourceHash)) return null;
    return { ...record, lastUsedAt: now };
  } catch {
    persistentUnavailable = true;
    return getMemoryFingerprint(name, sourceHash, now);
  }
}

export async function saveDedupeFingerprintCacheRecords(records: DedupeFingerprintCacheInput[]): Promise<void> {
  if (records.length === 0) return;
  const now = Date.now();
  const nextRecords = records.map(record => ({
    ...record,
    algorithmVersion: DUPLICATE_WORLDBOOK_ALGORITHM_VERSION,
    cachedAt: now,
    lastUsedAt: now,
  }));

  if (dedupeCacheUsesMemoryFallback()) {
    nextRecords.forEach(record => memoryFingerprints.set(record.name, record));
    pruneMemoryCache();
    return;
  }

  try {
    await withWriteTransaction([FINGERPRINT_STORE], stores => {
      const store = stores[FINGERPRINT_STORE];
      nextRecords.forEach(record => store.put(record));
    }, '保存智能去重缓存失败');
    await pruneDedupeCache();
  } catch {
    persistentUnavailable = true;
    nextRecords.forEach(record => memoryFingerprints.set(record.name, record));
    pruneMemoryCache();
  }
}

export function createDedupeComparisonCache(options: DedupeComparisonCacheOptions = {}): DuplicateWorldbookComparisonCache {
  let loaded = dedupeCacheUsesMemoryFallback();
  let loading: Promise<void> | null = null;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (!loading) {
      loading = loadPersistentComparisonsIntoMemory()
        .catch(() => {
          persistentUnavailable = true;
        })
        .finally(() => {
          loaded = true;
          loading = null;
        });
    }
    await loading;
  }

  return {
    async get(key: string) {
      await ensureLoaded();
      const record = memoryComparisons.get(key);
      if (isValidComparisonRecord(record)) {
        record.lastUsedAt = Date.now();
        options.onHit?.();
        return record.comparison;
      }
      return null;
    },
    async set(key: string, comparison: DuplicateWorldbookPairComparison) {
      await ensureLoaded();
      const now = Date.now();
      const record: DedupeComparisonCacheRecord = {
        id: key,
        algorithmVersion: DUPLICATE_WORLDBOOK_ALGORITHM_VERSION,
        comparison,
        cachedAt: now,
        lastUsedAt: now,
      };
      memoryComparisons.set(key, record);

      if (dedupeCacheUsesMemoryFallback()) {
        pruneMemoryCache();
        return;
      }

      try {
        await withStore<IDBValidKey>(
          COMPARISON_STORE,
          'readwrite',
          store => store.put(record),
          '保存世界书比较缓存失败',
        );
        comparisonWritesSincePrune += 1;
        if (comparisonWritesSincePrune >= COMPARISON_PRUNE_INTERVAL) {
          comparisonWritesSincePrune = 0;
          await pruneDedupeCache();
        }
      } catch {
        persistentUnavailable = true;
        pruneMemoryCache();
      }
    },
  };
}

export async function clearDedupeCache(): Promise<void> {
  memoryFingerprints.clear();
  memoryComparisons.clear();
  comparisonWritesSincePrune = 0;
  if (!hasIndexedDb() || persistentUnavailable) return;

  try {
    await withWriteTransaction(
      [FINGERPRINT_STORE, COMPARISON_STORE],
      stores => {
        stores[FINGERPRINT_STORE].clear();
        stores[COMPARISON_STORE].clear();
      },
      '清空智能去重缓存失败',
    );
  } catch {
    persistentUnavailable = true;
  }
}

export async function getDedupeCacheStats(): Promise<DedupeCacheStats> {
  if (dedupeCacheUsesMemoryFallback()) {
    return {
      fingerprintCount: memoryFingerprints.size,
      comparisonCount: memoryComparisons.size,
      memoryFallback: true,
    };
  }

  try {
    const [fingerprintCount, comparisonCount] = await Promise.all([
      withStore<number>(FINGERPRINT_STORE, 'readonly', store => store.count(), '读取智能去重缓存数量失败'),
      withStore<number>(COMPARISON_STORE, 'readonly', store => store.count(), '读取世界书比较缓存数量失败'),
    ]);
    return { fingerprintCount, comparisonCount, memoryFallback: false };
  } catch {
    persistentUnavailable = true;
    return {
      fingerprintCount: memoryFingerprints.size,
      comparisonCount: memoryComparisons.size,
      memoryFallback: true,
    };
  }
}

async function loadPersistentComparisonsIntoMemory(): Promise<void> {
  if (dedupeCacheUsesMemoryFallback()) return;
  const records = await withStore<DedupeComparisonCacheRecord[]>(
    COMPARISON_STORE,
    'readonly',
    store => store.getAll(),
    '读取世界书比较缓存失败',
  );
  memoryComparisons.clear();
  records.filter(isValidComparisonRecord).forEach(record => memoryComparisons.set(record.id, record));
}

async function pruneDedupeCache(): Promise<void> {
  pruneMemoryCache();
  if (dedupeCacheUsesMemoryFallback()) return;

  try {
    const [fingerprints, comparisons] = await Promise.all([
      withStore<DedupeFingerprintCacheRecord[]>(
        FINGERPRINT_STORE,
        'readonly',
        store => store.getAll(),
        '读取智能去重缓存失败',
      ),
      withStore<DedupeComparisonCacheRecord[]>(
        COMPARISON_STORE,
        'readonly',
        store => store.getAll(),
        '读取世界书比较缓存失败',
      ),
    ]);
    const staleFingerprints = staleIds(fingerprints, MAX_FINGERPRINT_RECORDS, record => record.name);
    const staleComparisons = staleIds(comparisons, MAX_COMPARISON_RECORDS, record => record.id);
    if (staleFingerprints.length === 0 && staleComparisons.length === 0) return;

    await withWriteTransaction(
      [FINGERPRINT_STORE, COMPARISON_STORE],
      stores => {
        staleFingerprints.forEach(id => stores[FINGERPRINT_STORE].delete(id));
        staleComparisons.forEach(id => stores[COMPARISON_STORE].delete(id));
      },
      '裁剪智能去重缓存失败',
    );
  } catch {
    persistentUnavailable = true;
  }
}

function getMemoryFingerprint(
  name: string,
  sourceHash: string,
  now: number,
): DedupeFingerprintCacheRecord | null {
  const record = memoryFingerprints.get(name);
  if (!isValidFingerprintRecord(record, sourceHash)) return null;
  const nextRecord = { ...record, lastUsedAt: now };
  memoryFingerprints.set(name, nextRecord);
  return nextRecord;
}

function pruneMemoryCache(): void {
  pruneMemoryMap(memoryFingerprints, MAX_FINGERPRINT_RECORDS);
  pruneMemoryMap(memoryComparisons, MAX_COMPARISON_RECORDS);
}

function pruneMemoryMap<T extends { lastUsedAt: number }>(map: Map<string, T>, maxCount: number): void {
  if (map.size <= maxCount) return;
  const staleKeys = [...map.entries()]
    .sort((left, right) => right[1].lastUsedAt - left[1].lastUsedAt)
    .slice(maxCount)
    .map(([key]) => key);
  staleKeys.forEach(key => map.delete(key));
}

function staleIds<T extends { algorithmVersion: string; lastUsedAt: number }>(
  records: T[],
  maxCount: number,
  getId: (record: T) => string,
): string[] {
  const invalidIds = records
    .filter(record => record.algorithmVersion !== DUPLICATE_WORLDBOOK_ALGORITHM_VERSION)
    .map(getId);
  const overflowIds = records
    .filter(record => record.algorithmVersion === DUPLICATE_WORLDBOOK_ALGORITHM_VERSION)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    .slice(maxCount)
    .map(getId);
  return [...invalidIds, ...overflowIds];
}

function isValidFingerprintRecord(
  record: DedupeFingerprintCacheRecord | undefined,
  sourceHash: string,
): record is DedupeFingerprintCacheRecord {
  return (
    Boolean(record) &&
    record?.algorithmVersion === DUPLICATE_WORLDBOOK_ALGORITHM_VERSION &&
    record.sourceHash === sourceHash
  );
}

function isValidComparisonRecord(
  record: DedupeComparisonCacheRecord | undefined,
): record is DedupeComparisonCacheRecord {
  return Boolean(record) && record?.algorithmVersion === DUPLICATE_WORLDBOOK_ALGORITHM_VERSION;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && Boolean(indexedDB);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('打开智能去重缓存失败'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      getOrCreateStore(db, FINGERPRINT_STORE, transaction);
      getOrCreateStore(db, COMPARISON_STORE, transaction);
    };
  });
}

function getOrCreateStore(
  db: IDBDatabase,
  storeName: string,
  transaction: IDBTransaction | null,
): IDBObjectStore {
  if (db.objectStoreNames.contains(storeName) && transaction) return transaction.objectStore(storeName);
  const store = db.createObjectStore(storeName, { keyPath: storeName === FINGERPRINT_STORE ? 'name' : 'id' });
  store.createIndex('lastUsedAt', 'lastUsedAt');
  return store;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
  failureMessage: string,
  afterRead?: (store: IDBObjectStore, value: T) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result: T | undefined;

    transaction.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error(failureMessage));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error(`${failureMessage}，事务被中止`));
    };

    try {
      const request = callback(store);
      request.onsuccess = () => {
        result = request.result;
        afterRead?.(store, result);
      };
      request.onerror = () => {
        db.close();
        reject(request.error ?? new Error(failureMessage));
      };
    } catch (error) {
      transaction.abort();
      db.close();
      reject(error);
    }
  });
}

async function withWriteTransaction(
  storeNames: string[],
  callback: (stores: Record<string, IDBObjectStore>) => void,
  failureMessage: string,
): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeNames, 'readwrite');
    const stores = Object.fromEntries(storeNames.map(storeName => [storeName, transaction.objectStore(storeName)]));
    callback(stores);
    await transactionDone(transaction, failureMessage);
  } finally {
    db.close();
  }
}

function transactionDone(transaction: IDBTransaction, failureMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(failureMessage));
    transaction.onabort = () => reject(transaction.error ?? new Error(`${failureMessage}，事务被中止`));
  });
}
