import { createTextHash } from './diff';
import { estimateCacheCost } from './pricing';
import { saveCacheCapture } from './storage';
import type { CacheSummaryRecord, CacheUsageSnapshot, PromptMessageSnapshot, PromptSnapshotRecord } from './types';

const TARGET_API = '/api/backends/chat-completions/generate';
export const CACHE_RECORDS_CHANGED_EVENT = 'worldbook-manager:cache-records-changed';

type MonitorWindow = Window &
  typeof globalThis & {
    __wbmCacheInspectorRawFetch?: typeof fetch;
    __wbmCacheInspectorPatchedFetch?: typeof fetch;
    __wbmCacheInspectorInstallCount?: number;
    __wbmCacheInspectorRequestCounter?: number;
  };

type PendingCapture = {
  summary: CacheSummaryRecord;
  snapshot: PromptSnapshotRecord | null;
};

export type CacheInspectorMonitorHandle = {
  destroy: () => void;
};

export function installCacheInspectorMonitor(): CacheInspectorMonitorHandle {
  const targetWindow = getTargetWindow();
  targetWindow.__wbmCacheInspectorInstallCount = (targetWindow.__wbmCacheInspectorInstallCount ?? 0) + 1;
  targetWindow.__wbmCacheInspectorRequestCounter ??= 0;

  if (!targetWindow.__wbmCacheInspectorRawFetch) {
    targetWindow.__wbmCacheInspectorRawFetch = targetWindow.fetch.bind(targetWindow);
    targetWindow.__wbmCacheInspectorPatchedFetch = createPatchedFetch(targetWindow);
    targetWindow.fetch = targetWindow.__wbmCacheInspectorPatchedFetch;
  }

  return {
    destroy: () => {
      const nextCount = Math.max(0, (targetWindow.__wbmCacheInspectorInstallCount ?? 1) - 1);
      targetWindow.__wbmCacheInspectorInstallCount = nextCount;
      if (nextCount > 0 || !targetWindow.__wbmCacheInspectorRawFetch) return;
      if (targetWindow.fetch !== targetWindow.__wbmCacheInspectorPatchedFetch) return;
      targetWindow.fetch = targetWindow.__wbmCacheInspectorRawFetch;
      delete targetWindow.__wbmCacheInspectorRawFetch;
      delete targetWindow.__wbmCacheInspectorPatchedFetch;
    },
  };
}

function createPatchedFetch(targetWindow: MonitorWindow): typeof fetch {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const rawFetch = targetWindow.__wbmCacheInspectorRawFetch ?? targetWindow.fetch.bind(targetWindow);
    if (!shouldCapture(args[0])) return rawFetch(...args);

    const payload = await readPayload(args[0], args[1]);
    const capture = createPendingCapture(targetWindow, payload);
    void saveCaptureSilently(capture.summary, capture.snapshot);

    try {
      const response = await rawFetch(...args);
      void hydrateRecordFromResponse(capture.summary, response);
      return response;
    } catch (error) {
      await saveCaptureSilently({
        ...capture.summary,
        status: 'failed',
        errorMessage: formatError(error),
      });
      throw error;
    }
  };
}

async function hydrateRecordFromResponse(record: CacheSummaryRecord, response: Response): Promise<void> {
  try {
    const text = await response.clone().text();
    const usage = extractUsageFromResponseText(text);
    const usageSnapshot = usageToSnapshot(usage);
    const pricing = estimateCacheCost(record.model, usageSnapshot);
    await saveCaptureSilently({
      ...record,
      ...usageSnapshot,
      ...pricing,
      status: 'completed',
      errorMessage: usage ? null : '未返回缓存数据',
    });
  } catch (error) {
    await saveCaptureSilently({
      ...record,
      status: 'completed',
      errorMessage: `读取缓存数据失败：${formatError(error)}`,
    });
  }
}

function shouldCapture(input: RequestInfo | URL): boolean {
  const url = requestUrl(input);
  return url.includes(TARGET_API);
}

async function readPayload(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown> | null> {
  const initBody = init?.body;
  if (typeof initBody === 'string') return parseJsonObject(initBody);
  if (isRequestLike(input)) {
    try {
      const text = await input.clone().text();
      return parseJsonObject(text);
    } catch {
      return null;
    }
  }
  return null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (isRequestLike(input)) return input.url;
  return input.toString();
}

function createPendingCapture(targetWindow: MonitorWindow, payload: Record<string, unknown> | null): PendingCapture {
  targetWindow.__wbmCacheInspectorRequestCounter = (targetWindow.__wbmCacheInspectorRequestCounter ?? 0) + 1;
  const timestamp = Date.now();
  const id = `cache_${timestamp}_${targetWindow.__wbmCacheInspectorRequestCounter}`;
  const messages = Array.isArray(payload?.messages) ? payload.messages.map(messageToSnapshot) : [];
  const model = typeof payload?.model === 'string' && payload.model.trim() ? payload.model : '当前模型';
  const promptChars = messages.reduce((sum, message) => sum + message.length, 0);
  const snapshot = messages.length > 0 ? { id, timestamp, messages } : null;

  return {
    summary: {
      id,
      timestamp,
      status: 'pending',
      model,
      messageCount: messages.length,
      promptChars,
      snapshotAvailable: !!snapshot,
      hitTokens: 0,
      missTokens: 0,
      totalCacheTokens: 0,
      hitRate: null,
      outputTokens: 0,
      totalTokens: 0,
      rawUsage: null,
      pricingSnapshot: null,
      costSnapshot: null,
      errorMessage: null,
    },
    snapshot,
  };
}

function messageToSnapshot(message: unknown): PromptMessageSnapshot {
  const record = isRecord(message) ? message : {};
  const role = typeof record.role === 'string' ? record.role : 'unknown';
  const text = messageContentToText(record.content);
  return {
    role,
    text,
    length: text.length,
    hash: createTextHash(text),
  };
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map(part => {
      if (!isRecord(part)) return '';
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      if (part.type === 'image_url') return '[image]';
      if (part.type === 'video_url') return '[video]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractUsageFromResponseText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const directJson = parseJsonObject(trimmed);
  if (directJson) return extractUsageObject(directJson);

  let usage: Record<string, unknown> | null = null;
  for (const line of trimmed.split(/\r?\n/u)) {
    const data = line.trim().replace(/^data:\s*/u, '');
    if (!data || data === '[DONE]' || data === line.trim()) continue;
    const parsed = parseJsonObject(data);
    const nextUsage = parsed ? extractUsageObject(parsed) : null;
    if (nextUsage) usage = nextUsage;
  }
  return usage;
}

function extractUsageObject(value: Record<string, unknown>): Record<string, unknown> | null {
  const usage = firstRecord(value.usage, value.usageMetadata, value.usage_metadata);
  if (usage) return usage;

  const response = firstRecord(value.response, value.data);
  if (!response) return null;
  return firstRecord(response.usage, response.usageMetadata, response.usage_metadata);
}

function usageToSnapshot(usage: Record<string, unknown> | null): CacheUsageSnapshot {
  if (!usage) {
    return emptyUsageSnapshot(null);
  }

  const promptDetails = firstRecord(usage.prompt_tokens_details, usage.input_tokens_details) ?? {};
  const hitTokens = firstNumber(
    usage.prompt_cache_hit_tokens,
    promptDetails.cached_tokens,
    usage.cachedContentTokenCount,
    usage.cached_content_token_count,
    usage.cache_read_input_tokens,
  );
  const explicitMissTokens = firstOptionalNumber(
    usage.prompt_cache_miss_tokens,
    promptDetails.uncached_tokens,
    usage.cache_creation_input_tokens,
  );
  const promptTokens = firstOptionalNumber(
    usage.prompt_tokens,
    usage.promptTokenCount,
    usage.prompt_token_count,
    usage.input_tokens,
    usage.inputTokens,
  );
  const missTokens = explicitMissTokens ?? Math.max(0, (promptTokens ?? 0) - hitTokens);
  const totalCacheTokens = hitTokens + missTokens;
  const outputTokens = firstNumber(
    usage.completion_tokens,
    usage.output_tokens,
    usage.outputTokens,
    usage.candidatesTokenCount,
    usage.candidates_token_count,
  );
  const totalTokens =
    firstOptionalNumber(usage.total_tokens, usage.totalTokens, usage.totalTokenCount, usage.total_token_count) ??
    totalCacheTokens + outputTokens;

  return {
    hitTokens,
    missTokens,
    totalCacheTokens,
    hitRate: totalCacheTokens > 0 ? hitTokens / totalCacheTokens : null,
    outputTokens,
    totalTokens,
    rawUsage: usage,
  };
}

function emptyUsageSnapshot(rawUsage: Record<string, unknown> | null): CacheUsageSnapshot {
  return {
    hitTokens: 0,
    missTokens: 0,
    totalCacheTokens: 0,
    hitRate: null,
    outputTokens: 0,
    totalTokens: 0,
    rawUsage,
  };
}

async function saveCaptureSilently(summary: CacheSummaryRecord, snapshot?: PromptSnapshotRecord | null): Promise<void> {
  try {
    await saveCacheCapture(summary, snapshot);
    dispatchRecordsChanged(summary.id);
  } catch (error) {
    console.warn('[缓存命中对比] 保存缓存记录失败', error);
  }
}

function dispatchRecordsChanged(recordId?: string): void {
  window.dispatchEvent(new CustomEvent(CACHE_RECORDS_CHANGED_EVENT, { detail: { recordId } }));
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return null;
}

function firstNumber(...values: unknown[]): number {
  return firstOptionalNumber(...values) ?? 0;
}

function firstOptionalNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestLike(value: unknown): value is Request {
  return isRecord(value) && typeof value.url === 'string' && typeof value.clone === 'function';
}

function getTargetWindow(): MonitorWindow {
  return (window.parent || window) as MonitorWindow;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
