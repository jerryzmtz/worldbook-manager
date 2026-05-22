import type { CacheRecord, CacheSummaryRecord, PromptSnapshotRecord } from './types';

const DB_NAME = 'WorldbookCacheInspectorDB';
const DB_VERSION = 2;
const LEGACY_RECORD_STORE = 'records';
const SUMMARY_STORE = 'summaryRecords';
const SNAPSHOT_STORE = 'promptSnapshots';
const MAX_SUMMARY_RECORDS = 10000;
const MAX_PROMPT_SNAPSHOTS = 500;
const MAX_PROMPT_SNAPSHOT_BYTES = 128 * 1024 * 1024;

type StoreMap = {
  summary: IDBObjectStore;
  snapshot: IDBObjectStore;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error('打开缓存记录数据库失败'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      const summaryStore = getOrCreateStore(db, SUMMARY_STORE, transaction);
      const snapshotStore = getOrCreateStore(db, SNAPSHOT_STORE, transaction);

      if (db.objectStoreNames.contains(LEGACY_RECORD_STORE) && transaction) {
        migrateLegacyRecords(transaction.objectStore(LEGACY_RECORD_STORE), summaryStore, snapshotStore);
      }
    };
  });
}

function getOrCreateStore(db: IDBDatabase, storeName: string, transaction: IDBTransaction | null): IDBObjectStore {
  if (db.objectStoreNames.contains(storeName) && transaction) {
    return transaction.objectStore(storeName);
  }

  const store = db.createObjectStore(storeName, { keyPath: 'id' });
  store.createIndex('timestamp', 'timestamp');
  return store;
}

function migrateLegacyRecords(
  legacyStore: IDBObjectStore,
  summaryStore: IDBObjectStore,
  snapshotStore: IDBObjectStore,
): void {
  const request = legacyStore.getAll();
  request.onsuccess = () => {
    const legacyRecords = (request.result as CacheRecord[]).sort((left, right) => right.timestamp - left.timestamp);
    legacyRecords.forEach((record, index) => {
      const snapshotAvailable = index < MAX_PROMPT_SNAPSHOTS && record.messages.length > 0;
      summaryStore.put(legacyRecordToSummary(record, snapshotAvailable));
      if (snapshotAvailable) {
        snapshotStore.put({
          id: record.id,
          timestamp: record.timestamp,
          messages: record.messages,
        } satisfies PromptSnapshotRecord);
      }
    });
  };
}

function legacyRecordToSummary(record: CacheRecord, snapshotAvailable: boolean): CacheSummaryRecord {
  return {
    id: record.id,
    timestamp: record.timestamp,
    status: record.status,
    model: record.model,
    messageCount: record.messages.length,
    promptChars: record.messages.reduce((sum, message) => sum + message.length, 0),
    snapshotAvailable,
    hitTokens: record.hitTokens,
    missTokens: record.missTokens,
    totalCacheTokens: record.totalCacheTokens,
    hitRate: record.hitRate,
    outputTokens: record.outputTokens ?? 0,
    totalTokens: record.totalTokens ?? record.totalCacheTokens,
    rawUsage: record.rawUsage,
    pricingSnapshot: record.pricingSnapshot ?? null,
    costSnapshot: record.costSnapshot ?? null,
    errorMessage: record.errorMessage,
  };
}

function requestToPromise<T>(request: IDBRequest<T>, failureMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(failureMessage));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
  failureMessage: string,
): Promise<T> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    return await requestToPromise(callback(store), failureMessage);
  } finally {
    db.close();
  }
}

async function withCacheStores(mode: IDBTransactionMode, callback: (stores: StoreMap) => void): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([SUMMARY_STORE, SNAPSHOT_STORE], mode);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('访问缓存记录数据库失败'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error('缓存记录数据库事务被中止'));
    };

    try {
      callback({
        summary: transaction.objectStore(SUMMARY_STORE),
        snapshot: transaction.objectStore(SNAPSHOT_STORE),
      });
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function listCacheSummaries(): Promise<CacheSummaryRecord[]> {
  const records = await withStore<CacheSummaryRecord[]>(
    SUMMARY_STORE,
    'readonly',
    store => store.getAll(),
    '读取缓存统计失败',
  );
  return records.sort((left, right) => right.timestamp - left.timestamp);
}

export async function getCacheSummary(id: string): Promise<CacheSummaryRecord | null> {
  const record = await withStore<CacheSummaryRecord | undefined>(
    SUMMARY_STORE,
    'readonly',
    store => store.get(id),
    '读取缓存统计失败',
  );
  return record ?? null;
}

export async function getPromptSnapshot(id: string): Promise<PromptSnapshotRecord | null> {
  const record = await withStore<PromptSnapshotRecord | undefined>(
    SNAPSHOT_STORE,
    'readonly',
    store => store.get(id),
    '读取缓存提示词快照失败',
  );
  return record ?? null;
}

export async function getCacheRecord(id: string): Promise<CacheRecord | null> {
  const [summary, snapshot] = await Promise.all([getCacheSummary(id), getPromptSnapshot(id)]);
  if (!summary) return null;
  return {
    ...summary,
    messages: snapshot?.messages ?? [],
  };
}

export async function listCacheRecords(): Promise<CacheRecord[]> {
  const summaries = await listCacheSummaries();
  const snapshots = await withStore<PromptSnapshotRecord[]>(
    SNAPSHOT_STORE,
    'readonly',
    store => store.getAll(),
    '读取缓存提示词快照失败',
  );
  const snapshotMap = new Map(snapshots.map(snapshot => [snapshot.id, snapshot.messages]));
  return summaries.map(summary => ({
    ...summary,
    messages: snapshotMap.get(summary.id) ?? [],
  }));
}

export async function saveCacheCapture(
  summary: CacheSummaryRecord,
  snapshot?: PromptSnapshotRecord | null,
): Promise<void> {
  await withCacheStores('readwrite', stores => {
    stores.summary.put(summary);
    if (snapshot) {
      stores.snapshot.put(snapshot);
    }
  });
  await pruneOldRecords();
}

export async function saveCacheRecord(record: CacheRecord): Promise<void> {
  await saveCacheCapture(record, {
    id: record.id,
    timestamp: record.timestamp,
    messages: record.messages,
  });
}

export async function clearCacheRecords(): Promise<void> {
  await withCacheStores('readwrite', stores => {
    stores.summary.clear();
    stores.snapshot.clear();
  });
}

async function pruneOldRecords(): Promise<void> {
  const summaries = await listCacheSummaries();
  const staleSummaries = summaries.slice(MAX_SUMMARY_RECORDS);
  const staleSummaryIds = new Set(staleSummaries.map(record => record.id));

  const snapshots = await withStore<PromptSnapshotRecord[]>(
    SNAPSHOT_STORE,
    'readonly',
    store => store.getAll(),
    '读取缓存提示词快照失败',
  );
  const sortedSnapshots = snapshots.sort((left, right) => right.timestamp - left.timestamp);
  let retainedSnapshotBytes = 0;
  const staleSnapshots = sortedSnapshots.filter((snapshot, index) => {
    if (index >= MAX_PROMPT_SNAPSHOTS || staleSummaryIds.has(snapshot.id)) return true;
    const snapshotBytes = estimatePromptSnapshotBytes(snapshot);
    if (retainedSnapshotBytes + snapshotBytes > MAX_PROMPT_SNAPSHOT_BYTES) return true;
    retainedSnapshotBytes += snapshotBytes;
    return false;
  });

  if (staleSummaries.length === 0 && staleSnapshots.length === 0) return;

  await withCacheStores('readwrite', stores => {
    staleSummaries.forEach(record => {
      stores.summary.delete(record.id);
      stores.snapshot.delete(record.id);
    });
    staleSnapshots.forEach(snapshot => {
      stores.snapshot.delete(snapshot.id);
      const summary = summaries.find(record => record.id === snapshot.id);
      if (summary && !staleSummaryIds.has(summary.id) && summary.snapshotAvailable) {
        stores.summary.put({
          ...summary,
          snapshotAvailable: false,
        });
      }
    });
  });
}

function estimatePromptSnapshotBytes(snapshot: PromptSnapshotRecord): number {
  return snapshot.messages.reduce((sum, message) => {
    return sum + 512 + message.role.length * 2 + message.hash.length * 2 + message.text.length * 4;
  }, 512 + snapshot.id.length * 2);
}
