import { createTextHash } from './diff';
import type {
  CacheRecord,
  CacheRecordStatus,
  CacheSummaryRecord,
  PromptMessageSnapshot,
  PromptSnapshotRecord,
} from './types';

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
    const legacyRecords = toArray(request.result)
      .map(normalizeLegacyRecord)
      .filter((record): record is CacheRecord => !!record)
      .sort((left, right) => right.timestamp - left.timestamp);
    let retainedSnapshotBytes = 0;
    legacyRecords.forEach((record, index) => {
      const snapshotBytes = estimatePromptSnapshotBytes(record);
      const snapshotAvailable =
        index < MAX_PROMPT_SNAPSHOTS &&
        record.messages.length > 0 &&
        retainedSnapshotBytes + snapshotBytes <= MAX_PROMPT_SNAPSHOT_BYTES;
      summaryStore.put(legacyRecordToSummary(record, snapshotAvailable));
      if (snapshotAvailable) {
        retainedSnapshotBytes += snapshotBytes;
        snapshotStore.put({
          id: record.id,
          timestamp: record.timestamp,
          messages: record.messages,
        } satisfies PromptSnapshotRecord);
      }
    });
  };
}

function normalizeLegacyRecord(value: unknown): CacheRecord | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id);
  if (!id) return null;

  const messages = normalizeLegacyMessages(value.messages);
  const promptChars = messages.reduce((sum, message) => sum + message.length, 0);
  const hitTokens = normalizeNumber(value.hitTokens, 0);
  const missTokens = normalizeNumber(value.missTokens, 0);
  const totalCacheTokens = normalizeNumber(value.totalCacheTokens, hitTokens + missTokens);
  const outputTokens = normalizeNumber(value.outputTokens, 0);
  const totalTokens = normalizeNumber(value.totalTokens, totalCacheTokens);

  return {
    id,
    timestamp: normalizeNumber(value.timestamp, 0),
    status: normalizeStatus(value.status),
    model: normalizeString(value.model, '当前模型'),
    messageCount: messages.length > 0 ? messages.length : normalizeNumber(value.messageCount, 0),
    promptChars: promptChars > 0 ? promptChars : normalizeNumber(value.promptChars, 0),
    snapshotAvailable: messages.length > 0,
    messages,
    hitTokens,
    missTokens,
    totalCacheTokens,
    hitRate: normalizeNullableNumber(value.hitRate),
    outputTokens,
    totalTokens,
    rawUsage: isRecord(value.rawUsage) ? value.rawUsage : null,
    pricingSnapshot: isRecord(value.pricingSnapshot)
      ? (value.pricingSnapshot as CacheSummaryRecord['pricingSnapshot'])
      : null,
    costSnapshot: isRecord(value.costSnapshot) ? (value.costSnapshot as CacheSummaryRecord['costSnapshot']) : null,
    errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : null,
  };
}

function legacyRecordToSummary(record: CacheRecord, snapshotAvailable: boolean): CacheSummaryRecord {
  return {
    id: record.id,
    timestamp: record.timestamp,
    status: record.status,
    model: record.model,
    messageCount: record.messageCount,
    promptChars: record.promptChars,
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

function normalizeLegacyMessages(value: unknown): PromptMessageSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeLegacyMessage).filter((message): message is PromptMessageSnapshot => !!message);
}

function normalizeLegacyMessage(value: unknown): PromptMessageSnapshot | null {
  if (typeof value === 'string') return createPromptSnapshot('unknown', value);
  if (!isRecord(value)) return null;
  const text = normalizeString(value.text, normalizeString(value.content, ''));
  if (!text) return null;
  return {
    role: normalizeString(value.role, 'unknown'),
    text,
    length: normalizeNumber(value.length, text.length),
    hash: normalizeString(value.hash, createTextHash(text)),
  };
}

function createPromptSnapshot(role: string, text: string): PromptMessageSnapshot {
  return {
    role,
    text,
    length: text.length,
    hash: createTextHash(text),
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeStatus(value: unknown): CacheRecordStatus {
  return value === 'pending' || value === 'completed' || value === 'failed' ? value : 'completed';
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
    '读取完整提示词失败',
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
    '读取完整提示词失败',
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
  let summaries = await listCacheSummaries();
  const stalePendingIds = summaries.filter(record => record.status === 'pending').map(record => record.id);
  if (stalePendingIds.length > 0) {
    await deleteSummariesAndSnapshots(stalePendingIds);
    summaries = summaries.filter(record => record.status !== 'pending');
  }

  const staleSummaries = summaries.slice(MAX_SUMMARY_RECORDS);
  const staleSummaryIds = new Set(staleSummaries.map(record => record.id));

  const staleSnapshotIds = await collectStaleSnapshotIds(summaries, staleSummaryIds);

  if (staleSummaries.length === 0 && staleSnapshotIds.size === 0) return;

  const summaryById = new Map(summaries.map(record => [record.id, record]));
  await withCacheStores('readwrite', stores => {
    staleSummaries.forEach(record => {
      stores.summary.delete(record.id);
      stores.snapshot.delete(record.id);
    });
    staleSnapshotIds.forEach(id => {
      stores.snapshot.delete(id);
      const summary = summaryById.get(id);
      if (summary && !staleSummaryIds.has(summary.id) && summary.snapshotAvailable) {
        stores.summary.put({
          ...summary,
          snapshotAvailable: false,
        });
      }
    });
  });
}

async function collectStaleSnapshotIds(
  summaries: CacheSummaryRecord[],
  staleSummaryIds: Set<string>,
): Promise<Set<string>> {
  const summaryIds = new Set(summaries.map(record => record.id));
  const staleSnapshotIds = new Set<string>();
  let retainedSnapshotBytes = 0;
  let retainedSnapshotCount = 0;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
      transaction.onerror = () => reject(transaction.error ?? new Error('读取完整提示词失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('完整提示词读取被中止'));
      const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
      const cursorSource = snapshotStore.indexNames.contains('timestamp')
        ? snapshotStore.index('timestamp')
        : snapshotStore;
      const request = cursorSource.openCursor(null, 'prev');
      request.onerror = () => reject(request.error ?? new Error('读取完整提示词失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        const snapshot = cursor.value as PromptSnapshotRecord;
        const snapshotBytes = estimatePromptSnapshotBytes(snapshot);
        const shouldDelete =
          !summaryIds.has(snapshot.id) ||
          staleSummaryIds.has(snapshot.id) ||
          retainedSnapshotCount >= MAX_PROMPT_SNAPSHOTS ||
          retainedSnapshotBytes + snapshotBytes > MAX_PROMPT_SNAPSHOT_BYTES;

        if (shouldDelete) {
          staleSnapshotIds.add(snapshot.id);
        } else {
          retainedSnapshotCount += 1;
          retainedSnapshotBytes += snapshotBytes;
        }
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
  return staleSnapshotIds;
}

async function deleteSummariesAndSnapshots(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withCacheStores('readwrite', stores => {
    ids.forEach(id => {
      stores.summary.delete(id);
      stores.snapshot.delete(id);
    });
  });
}

function estimatePromptSnapshotBytes(snapshot: PromptSnapshotRecord): number {
  return snapshot.messages.reduce(
    (sum, message) => {
      return sum + 512 + message.role.length * 2 + message.hash.length * 2 + message.text.length * 4;
    },
    512 + snapshot.id.length * 2,
  );
}
