import { createTextHash } from './diff';
import { refreshUsdToCnyRate } from './exchange-rate';
import { estimateCacheCost } from './pricing';
import { saveCacheCapture } from './storage';
import type { CacheSummaryRecord, CacheUsageSnapshot, PromptMessageSnapshot, PromptSnapshotRecord } from './types';

const TARGET_API = '/api/backends/chat-completions/generate';
export const CACHE_RECORDS_CHANGED_EVENT = 'worldbook-manager:cache-records-changed';

type MonitorWindow = Window &
  typeof globalThis & {
    __wbmCacheInspectorPatchState?: CacheInspectorPatchState;
    __wbmCacheInspectorDiagnostics?: () => CacheInspectorDiagnostics;
    __WBM_CACHE_INSPECTOR_DEBUG__?: boolean;
    $?: JQueryLike;
    jQuery?: JQueryLike;
    XMLHttpRequest?: typeof XMLHttpRequest;
    __TAURITAVERN__?: {
      ready?: PromiseLike<unknown> | null;
      invoke?: {
        broker?: TauriInvokeBroker | null;
      } | null;
      api?: {
        dev?: {
          llmApiLogs?: TauriLlmApiLogsApi;
        };
      };
    };
    __TAURITAVERN_MAIN_READY__?: PromiseLike<unknown> | null;
  };

type JQueryLike = {
  ajax?: AjaxFunction;
};

type AjaxFunction = (this: unknown, ...args: unknown[]) => unknown;

type TauriLlmApiLogIndexEntry = {
  id?: number;
  timestampMs?: number;
  ok?: boolean;
  source?: string;
  model?: string | null;
  endpoint?: string;
  stream?: boolean;
};

type TauriLlmApiLogRaw = {
  id?: number;
  requestRaw?: string;
  responseRaw?: string;
  responseRawKind?: 'json' | 'sse' | null;
};

type TauriLlmApiLogsApi = {
  index?: (options?: { limit?: number }) => PromiseLike<TauriLlmApiLogIndexEntry[]>;
  getRaw?: (id: number) => PromiseLike<TauriLlmApiLogRaw>;
  subscribeIndex?: (
    handler: (entry: TauriLlmApiLogIndexEntry) => void,
  ) => PromiseLike<() => void | PromiseLike<void>>;
};

type TauriInvokeFunction = (command: string, args?: unknown) => PromiseLike<unknown>;

type TauriInvokeBroker = {
  invoke?: TauriInvokeFunction;
};

type TauriInvokeBrokerPatch = {
  broker: TauriInvokeBroker;
  originalInvoke: TauriInvokeFunction;
  patchedInvoke: TauriInvokeFunction;
};

type CacheInspectorAjaxPatch = {
  owner: JQueryLike;
  delegateAjax: AjaxFunction;
  bypassAjax: AjaxFunction | null;
  patchedAjax: AjaxFunction;
  accessorInstalled: boolean;
  originalDescriptor: PropertyDescriptor | null;
  ajaxDelegateDepth: number;
};

type PendingCapture = {
  summary: CacheSummaryRecord;
  snapshot: PromptSnapshotRecord | null;
};

type CacheInspectorPatchState = {
  delegateFetch: typeof fetch | null;
  bypassFetch: typeof fetch | null;
  patchedFetch: typeof fetch | null;
  fetchAccessorInstalled: boolean;
  fetchOriginalDescriptor: PropertyDescriptor | null;
  fetchDelegateDepth: number;
  ajaxPatches: CacheInspectorAjaxPatch[];
  delegateXMLHttpRequest: typeof XMLHttpRequest | null;
  patchedXMLHttpRequest: typeof XMLHttpRequest | null;
  installCount: number;
};

type CacheInspectorMonitorRuntime = {
  destroyed: boolean;
  requestCounter: number;
  targetWindows: Set<MonitorWindow>;
  readyPromise: PromiseLike<unknown> | null;
  readyCheckTimers: ReturnType<typeof setTimeout>[];
  watchdogTimer: ReturnType<typeof setInterval> | null;
  tauriLogApis: Set<TauriLlmApiLogsApi>;
  tauriLogProcessedIds: Set<number>;
  tauriLogProcessingIds: Set<number>;
  tauriLogUnsubscribers: Array<() => void | PromiseLike<void>>;
  tauriNativeLogActive: boolean;
  tauriPendingCaptures: PendingCapture[];
  tauriInvokeBrokerPatches: TauriInvokeBrokerPatch[];
};

type CacheInspectorDiagnostics = {
  href: string | null;
  fetch: {
    installed: boolean;
    currentIsPatched: boolean;
    hasDelegate: boolean;
    hasBypass: boolean;
  };
  ajax: Array<{
    installed: boolean;
    currentIsPatched: boolean;
    hasDelegate: boolean;
    hasBypass: boolean;
  }>;
  xhr: {
    installed: boolean;
    currentIsPatched: boolean;
  };
  tauriNativeLog: {
    active: boolean;
    subscriptions: number;
    processedIds: number;
  };
};

export type CacheInspectorMonitorHandle = {
  destroy: () => void;
};

export function installCacheInspectorMonitor(): CacheInspectorMonitorHandle {
  const runtime: CacheInspectorMonitorRuntime = {
    destroyed: false,
    requestCounter: 0,
    targetWindows: new Set(),
    readyPromise: null,
    readyCheckTimers: [],
    watchdogTimer: null,
    tauriLogApis: new Set(),
    tauriLogProcessedIds: new Set(),
    tauriLogProcessingIds: new Set(),
    tauriLogUnsubscribers: [],
    tauriNativeLogActive: false,
    tauriPendingCaptures: [],
    tauriInvokeBrokerPatches: [],
  };

  const installTargets = (): void => {
    if (runtime.destroyed) return;
    for (const targetWindow of getTargetWindows()) {
      retainTargetWindow(runtime, targetWindow);
      patchTargetWindow(runtime, targetWindow);
    }
    installTauriNativeLogMonitor(runtime);
    installTauriInvokeBrokerMonitor(runtime);
  };

  installTargets();
  void refreshUsdToCnyRate();
  scheduleTauriReadyReinstall(runtime, installTargets);
  runtime.watchdogTimer = setInterval(installTargets, 1000);

  return {
    destroy: () => {
      runtime.destroyed = true;
      if (runtime.watchdogTimer) clearInterval(runtime.watchdogTimer);
      runtime.watchdogTimer = null;
      runtime.readyCheckTimers.forEach(timer => clearTimeout(timer));
      runtime.readyCheckTimers.length = 0;
      for (const unsubscribe of runtime.tauriLogUnsubscribers.splice(0)) {
        void Promise.resolve(unsubscribe()).catch(error => {
          console.warn('[缓存命中对比] 取消 TauriTavern 原生日志订阅失败', error);
        });
      }
      for (const brokerPatch of runtime.tauriInvokeBrokerPatches.splice(0)) {
        restoreTauriInvokeBrokerPatch(brokerPatch);
      }
      runtime.targetWindows.forEach(releaseTargetWindow);
      runtime.targetWindows.clear();
    },
  };
}

function retainTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  if (runtime.targetWindows.has(targetWindow)) return;
  runtime.targetWindows.add(targetWindow);
  const patchState = getOrCreatePatchState(targetWindow);
  patchState.installCount += 1;
}

function releaseTargetWindow(targetWindow: MonitorWindow): void {
  const patchState = targetWindow.__wbmCacheInspectorPatchState;
  if (!patchState) return;

  patchState.installCount = Math.max(0, patchState.installCount - 1);
  if (patchState.installCount > 0) return;

  restoreFetchPatch(targetWindow, patchState);
  for (const ajaxPatch of patchState.ajaxPatches) {
    restoreAjaxPatch(ajaxPatch);
  }
  if (safeGetXMLHttpRequest(targetWindow) === patchState.patchedXMLHttpRequest && patchState.delegateXMLHttpRequest) {
    safeSetXMLHttpRequest(targetWindow, patchState.delegateXMLHttpRequest);
  }
  delete targetWindow.__wbmCacheInspectorPatchState;
}

function getOrCreatePatchState(targetWindow: MonitorWindow): CacheInspectorPatchState {
  const patchState = targetWindow.__wbmCacheInspectorPatchState;
  if (patchState) return patchState;

  const nextPatchState: CacheInspectorPatchState = {
    delegateFetch: null,
    bypassFetch: null,
    patchedFetch: null,
    fetchAccessorInstalled: false,
    fetchOriginalDescriptor: null,
    fetchDelegateDepth: 0,
    ajaxPatches: [],
    delegateXMLHttpRequest: null,
    patchedXMLHttpRequest: null,
    installCount: 0,
  };
  targetWindow.__wbmCacheInspectorPatchState = nextPatchState;
  return nextPatchState;
}

function patchTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  patchFetchTargetWindow(runtime, targetWindow);
  patchAjaxTargetWindow(runtime, targetWindow);
  patchXMLHttpRequestTargetWindow(runtime, targetWindow);
  installDiagnostics(runtime, targetWindow);
}

function patchFetchTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  const patchState = getOrCreatePatchState(targetWindow);
  if (patchState.fetchAccessorInstalled) return;

  const currentFetch = safeGetFetch(targetWindow);
  if (!currentFetch || currentFetch === patchState.patchedFetch) return;

  const delegateFetch = currentFetch.bind(targetWindow);
  const patchedFetch = createPatchedFetch(runtime, targetWindow, patchState);
  patchState.delegateFetch = delegateFetch;
  patchState.bypassFetch = delegateFetch;
  patchState.patchedFetch = patchedFetch;

  if (!installFetchAccessor(targetWindow, patchState) && !safeSetFetch(targetWindow, patchedFetch)) return;

  logDiagnostic(targetWindow, 'debug', 'fetch 监控已安装', {
    href: safeWindowHref(targetWindow),
    guarded: patchState.fetchAccessorInstalled,
  });
}

function patchAjaxTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  const patchState = getOrCreatePatchState(targetWindow);
  for (const ajaxOwner of getAjaxOwners(targetWindow)) {
    const currentAjax = safeGetAjax(ajaxOwner);
    const existingPatch = patchState.ajaxPatches.find(ajaxPatch => ajaxPatch.owner === ajaxOwner);
    if (!currentAjax || existingPatch?.accessorInstalled || currentAjax === existingPatch?.patchedAjax) continue;

    const delegateAjax = currentAjax;
    if (existingPatch) {
      existingPatch.delegateAjax = delegateAjax;
      existingPatch.bypassAjax ??= delegateAjax;
      existingPatch.patchedAjax = createPatchedAjax(runtime, targetWindow, existingPatch);
      if (!installAjaxAccessor(targetWindow, existingPatch) && !safeSetAjax(ajaxOwner, existingPatch.patchedAjax)) continue;
    } else {
      const ajaxPatch: CacheInspectorAjaxPatch = {
        owner: ajaxOwner,
        delegateAjax,
        bypassAjax: delegateAjax,
        patchedAjax: function placeholderAjax() {
          return undefined;
        },
        accessorInstalled: false,
        originalDescriptor: null,
        ajaxDelegateDepth: 0,
      };
      ajaxPatch.patchedAjax = createPatchedAjax(runtime, targetWindow, ajaxPatch);
      if (!installAjaxAccessor(targetWindow, ajaxPatch) && !safeSetAjax(ajaxOwner, ajaxPatch.patchedAjax)) continue;
      patchState.ajaxPatches.push(ajaxPatch);
    }

    logDiagnostic(targetWindow, 'debug', 'jQuery.ajax 监控已安装', {
      href: safeWindowHref(targetWindow),
    });
  }
}

function patchXMLHttpRequestTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  const patchState = getOrCreatePatchState(targetWindow);
  const currentXMLHttpRequest = safeGetXMLHttpRequest(targetWindow);
  if (!currentXMLHttpRequest || currentXMLHttpRequest === patchState.patchedXMLHttpRequest) return;

  const patchedXMLHttpRequest = createPatchedXMLHttpRequest(runtime, targetWindow, currentXMLHttpRequest);
  if (!safeSetXMLHttpRequest(targetWindow, patchedXMLHttpRequest)) return;

  patchState.delegateXMLHttpRequest = currentXMLHttpRequest;
  patchState.patchedXMLHttpRequest = patchedXMLHttpRequest;
}

function createPatchedFetch(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  patchState: CacheInspectorPatchState,
): typeof fetch {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    if (patchState.fetchDelegateDepth > 0 && patchState.bypassFetch) {
      return patchState.bypassFetch(...args);
    }

    if (!shouldCapture(args[0])) return callFetchDelegate(targetWindow, patchState, args);

    const payload = await readPayload(args[0], args[1]);
    const capture = createPendingCapture(runtime, payload);
    logDiagnostic(targetWindow, 'info', 'fetch 捕获生成请求', captureLogDetails(capture.summary), true);
    announcePendingCapture(capture.summary);
    void saveCaptureSilently(capture.summary, capture.snapshot);
    if (runtime.tauriNativeLogActive) {
      queueTauriPendingCapture(runtime, capture);
      try {
        return await callFetchDelegate(targetWindow, patchState, args);
      } catch (error) {
        forgetTauriPendingCapture(runtime, capture.summary.id);
        await saveCaptureSilently({
          ...capture.summary,
          status: 'failed',
          errorMessage: formatError(error),
        });
        logDiagnostic(targetWindow, 'warn', 'fetch 请求失败', {
          id: capture.summary.id,
          error: formatError(error),
        }, true);
        throw error;
      }
    }

    try {
      const response = await callFetchDelegate(targetWindow, patchState, args);
      void hydrateRecordFromResponse(capture.summary, response);
      return response;
    } catch (error) {
      await saveCaptureSilently({
        ...capture.summary,
        status: 'failed',
        errorMessage: formatError(error),
      });
      logDiagnostic(targetWindow, 'warn', 'fetch 请求失败', {
        id: capture.summary.id,
        error: formatError(error),
      }, true);
      throw error;
    }
  };
}

function createPatchedAjax(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  ajaxPatch: CacheInspectorAjaxPatch,
): AjaxFunction {
  return function patchedAjax(this: unknown, ...args: unknown[]): unknown {
    const request = getAjaxRequestDetails(args);
    if (ajaxPatch.ajaxDelegateDepth > 0 && ajaxPatch.bypassAjax) {
      return ajaxPatch.bypassAjax.apply(this, args);
    }

    if (!request || !shouldCapture(request.url)) return callAjaxDelegate(ajaxPatch, this, args);

    const capture = createPendingCapture(runtime, request.payload);
    logDiagnostic(targetWindow, 'info', 'jQuery.ajax 捕获生成请求', captureLogDetails(capture.summary), true);
    announcePendingCapture(capture.summary);
    void saveCaptureSilently(capture.summary, capture.snapshot);
    if (runtime.tauriNativeLogActive) {
      queueTauriPendingCapture(runtime, capture);
      try {
        const result = callAjaxDelegate(ajaxPatch, this, args);
        attachAjaxFailureHandler(capture.summary, result, () => forgetTauriPendingCapture(runtime, capture.summary.id));
        return result;
      } catch (error) {
        forgetTauriPendingCapture(runtime, capture.summary.id);
        void saveCaptureSilently({
          ...capture.summary,
          status: 'failed',
          errorMessage: formatError(error),
        });
        logDiagnostic(targetWindow, 'warn', 'jQuery.ajax 请求失败', {
          id: capture.summary.id,
          error: formatError(error),
        }, true);
        throw error;
      }
    }

    try {
      const result = callAjaxDelegate(ajaxPatch, this, args);
      attachAjaxCompletionHandlers(capture.summary, result);
      return result;
    } catch (error) {
      void saveCaptureSilently({
        ...capture.summary,
        status: 'failed',
        errorMessage: formatError(error),
      });
      logDiagnostic(targetWindow, 'warn', 'jQuery.ajax 请求失败', {
        id: capture.summary.id,
        error: formatError(error),
      }, true);
      throw error;
    }
  };
}

function createPatchedXMLHttpRequest(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  delegateXMLHttpRequest: typeof XMLHttpRequest,
): typeof XMLHttpRequest {
  const PatchedXMLHttpRequest = function patchedXMLHttpRequest(this: XMLHttpRequest): XMLHttpRequest {
    const xhr = new delegateXMLHttpRequest();
    const rawOpen = xhr.open;
    const rawSend = xhr.send;
    let requestUrlValue = '';

    xhr.open = function patchedOpen(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      requestUrlValue = typeof url === 'string' ? url : url.toString();
      return rawOpen.call(xhr, method, url, async ?? true, username ?? null, password ?? null);
    } as XMLHttpRequest['open'];

    xhr.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (shouldCapture(requestUrlValue)) {
        const capture = createPendingCapture(runtime, parseAjaxPayload(body));
        logDiagnostic(targetWindow, 'info', 'XMLHttpRequest 捕获生成请求', captureLogDetails(capture.summary), true);
        announcePendingCapture(capture.summary);
        void saveCaptureSilently(capture.summary, capture.snapshot);
        if (runtime.tauriNativeLogActive) queueTauriPendingCapture(runtime, capture);
        xhr.addEventListener(
          'loadend',
          () => {
            if (runtime.tauriNativeLogActive && xhr.status >= 200 && xhr.status < 400) return;
            if (runtime.tauriNativeLogActive) forgetTauriPendingCapture(runtime, capture.summary.id);
            if (xhr.status >= 200 && xhr.status < 400) {
              void hydrateRecordFromResponseText(capture.summary, xhr.responseText || '');
              return;
            }
            void saveCaptureSilently({
              ...capture.summary,
              status: 'failed',
              errorMessage: xhr.statusText || `XMLHttpRequest 请求失败：${xhr.status}`,
            });
          },
          { once: true },
        );
      }

      return rawSend.call(xhr, body ?? null);
    } as XMLHttpRequest['send'];

    return xhr;
  } as unknown as typeof XMLHttpRequest;

  try {
    PatchedXMLHttpRequest.prototype = delegateXMLHttpRequest.prototype;
  } catch {
    // 部分宿主可能冻结原型；不影响捕获本身。
  }

  copyXMLHttpRequestStatics(PatchedXMLHttpRequest, delegateXMLHttpRequest);
  return PatchedXMLHttpRequest;
}

function installTauriNativeLogMonitor(runtime: CacheInspectorMonitorRuntime): void {
  for (const targetWindow of getTargetWindows()) {
    const llmApiLogs = getTauriLlmApiLogsApi(targetWindow);
    if (!llmApiLogs || runtime.tauriLogApis.has(llmApiLogs)) continue;
    if (typeof llmApiLogs.getRaw !== 'function') continue;

    runtime.tauriLogApis.add(llmApiLogs);
    void startTauriNativeLogMonitor(runtime, targetWindow, llmApiLogs);
  }
}

function installTauriInvokeBrokerMonitor(runtime: CacheInspectorMonitorRuntime): void {
  for (const targetWindow of getTargetWindows()) {
    const broker = getTauriInvokeBroker(targetWindow);
    const currentInvoke = broker?.invoke;
    if (!broker || typeof currentInvoke !== 'function') continue;

    const existingPatch = runtime.tauriInvokeBrokerPatches.find(patch => patch.broker === broker);
    if (existingPatch) {
      if (currentInvoke === existingPatch.patchedInvoke) continue;
      existingPatch.originalInvoke = currentInvoke;
      existingPatch.patchedInvoke = createPatchedTauriInvoke(runtime, targetWindow, existingPatch);
      safeSetTauriInvoke(broker, existingPatch.patchedInvoke);
      logDiagnostic(targetWindow, 'info', 'TauriTavern invokeBroker 被宿主重写，已重新安装请求中捕获', {
        href: safeWindowHref(targetWindow),
      }, true);
      continue;
    }

    const brokerPatch: TauriInvokeBrokerPatch = {
      broker,
      originalInvoke: currentInvoke,
      patchedInvoke: function placeholderTauriInvoke() {
        return Promise.resolve(null);
      },
    };
    brokerPatch.patchedInvoke = createPatchedTauriInvoke(runtime, targetWindow, brokerPatch);
    if (!safeSetTauriInvoke(broker, brokerPatch.patchedInvoke)) continue;
    runtime.tauriInvokeBrokerPatches.push(brokerPatch);
    logDiagnostic(targetWindow, 'info', 'TauriTavern invokeBroker 请求中捕获已启用', {
      href: safeWindowHref(targetWindow),
    }, true);
  }
}

function createPatchedTauriInvoke(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  brokerPatch: TauriInvokeBrokerPatch,
): TauriInvokeFunction {
  return function patchedTauriInvoke(this: unknown, command: string, args?: unknown): PromiseLike<unknown> {
    const capture = createPendingCaptureFromTauriInvoke(runtime, targetWindow, command, args);
    let result: PromiseLike<unknown>;
    try {
      result = brokerPatch.originalInvoke.call(this, command, args);
    } catch (error) {
      if (capture) {
        forgetTauriPendingCapture(runtime, capture.summary.id);
        void saveCaptureSilently({
          ...capture.summary,
          status: 'failed',
          errorMessage: formatError(error),
        });
      }
      throw error;
    }

    if (!capture) return result;
    return Promise.resolve(result).then(
      value => {
        if (!runtime.tauriNativeLogActive && String(command) === 'generate_chat_completion') {
          void hydrateRecordFromResponseValue(capture.summary, value, safeStringify(value));
        }
        return value;
      },
      error => {
        forgetTauriPendingCapture(runtime, capture.summary.id);
        void saveCaptureSilently({
          ...capture.summary,
          status: 'failed',
          errorMessage: formatError(error),
        });
        throw error;
      },
    );
  };
}

function createPendingCaptureFromTauriInvoke(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  command: string,
  args: unknown,
): PendingCapture | null {
  const normalizedCommand = String(command || '').trim();
  if (normalizedCommand !== 'generate_chat_completion' && normalizedCommand !== 'start_chat_completion_stream') {
    return null;
  }

  const payload = getTauriInvokePayload(args);
  if (!payload || !isChatCompletionPayload(payload)) return null;
  if (findMatchingTauriPendingCapture(runtime, payload, Date.now(), 8_000)) return null;

  const capture = createPendingCapture(runtime, payload);
  logDiagnostic(targetWindow, 'info', 'TauriTavern 原生 invoke 捕获请求开始', {
    command: normalizedCommand,
    ...captureLogDetails(capture.summary),
  }, true);
  announcePendingCapture(capture.summary);
  void saveCaptureSilently(capture.summary, capture.snapshot);
  queueTauriPendingCapture(runtime, capture);
  return capture;
}

function getTauriInvokePayload(args: unknown): Record<string, unknown> | null {
  if (!isRecord(args) || !isRecord(args.dto)) return null;
  return args.dto;
}

function restoreTauriInvokeBrokerPatch(brokerPatch: TauriInvokeBrokerPatch): void {
  if (brokerPatch.broker.invoke !== brokerPatch.patchedInvoke) return;
  safeSetTauriInvoke(brokerPatch.broker, brokerPatch.originalInvoke);
}

async function startTauriNativeLogMonitor(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  llmApiLogs: TauriLlmApiLogsApi,
): Promise<void> {
  try {
    if (typeof llmApiLogs.subscribeIndex === 'function') {
      const unsubscribe = await llmApiLogs.subscribeIndex(entry => {
        void captureTauriLlmApiLog(runtime, targetWindow, llmApiLogs, entry);
      });
      if (runtime.destroyed) {
        await Promise.resolve(unsubscribe());
        return;
      }
      runtime.tauriLogUnsubscribers.push(unsubscribe);
      runtime.tauriNativeLogActive = true;
      logDiagnostic(targetWindow, 'info', 'TauriTavern 原生 LLM 日志订阅已启用', {
        href: safeWindowHref(targetWindow),
      }, true);
    }

    if (typeof llmApiLogs.index === 'function') {
      const entries = await llmApiLogs.index({ limit: 50 });
      for (const entry of entries) {
        void captureTauriLlmApiLog(runtime, targetWindow, llmApiLogs, entry);
      }
    }
  } catch (error) {
    runtime.tauriLogApis.delete(llmApiLogs);
    logDiagnostic(targetWindow, 'warn', 'TauriTavern 原生 LLM 日志订阅失败', {
      error: formatError(error),
    }, true);
  }
}

async function captureTauriLlmApiLog(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  llmApiLogs: TauriLlmApiLogsApi,
  entry: TauriLlmApiLogIndexEntry,
): Promise<void> {
  const logId = normalizePositiveInteger(entry.id);
  if (!logId || runtime.tauriLogProcessedIds.has(logId) || runtime.tauriLogProcessingIds.has(logId)) return;
  if (typeof llmApiLogs.getRaw !== 'function') return;

  runtime.tauriLogProcessingIds.add(logId);
  try {
    const raw = await getTauriLogRawWithRetry(llmApiLogs, logId);
    const payload = parseJsonObject(raw.requestRaw ?? '');
    if (!payload || !isChatCompletionPayload(payload)) {
      runtime.tauriLogProcessedIds.add(logId);
      return;
    }

    const queuedCapture = claimTauriPendingCapture(runtime, payload, entry.timestampMs);
    const capture = createPendingCapture(runtime, payload, queuedCapture?.summary.timestamp ?? entry.timestampMs);
    if (queuedCapture) {
      rebaseCaptureIdentity(capture, queuedCapture.summary.id, queuedCapture.summary.timestamp);
    }
    logDiagnostic(targetWindow, 'info', 'TauriTavern 原生日志捕获生成请求', {
      logId,
      source: entry.source ?? null,
      endpoint: entry.endpoint ?? null,
      stream: entry.stream ?? null,
      ...captureLogDetails(capture.summary),
    }, true);
    await saveCaptureSilently(capture.summary, capture.snapshot);

    if (entry.ok === false) {
      await saveCaptureSilently({
        ...capture.summary,
        status: 'failed',
        errorMessage: 'TauriTavern 后端请求失败',
      });
      runtime.tauriLogProcessedIds.add(logId);
      return;
    }

    if (raw.responseRawKind === 'json') {
      await hydrateRecordFromResponseValue(capture.summary, parseJsonObject(raw.responseRaw ?? ''), raw.responseRaw ?? '');
    } else {
      await hydrateRecordFromResponseText(capture.summary, raw.responseRaw ?? '');
    }
    runtime.tauriLogProcessedIds.add(logId);
  } catch (error) {
    logDiagnostic(targetWindow, 'warn', '读取 TauriTavern 原生 LLM 日志失败', {
      logId,
      error: formatError(error),
    }, true);
  } finally {
    runtime.tauriLogProcessingIds.delete(logId);
  }
}

function queueTauriPendingCapture(runtime: CacheInspectorMonitorRuntime, capture: PendingCapture): void {
  pruneTauriPendingCaptures(runtime, Date.now());
  runtime.tauriPendingCaptures.push(capture);
}

function findMatchingTauriPendingCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown>,
  completedAt: number,
  maxAgeMs = 15 * 60 * 1000,
): PendingCapture | null {
  pruneTauriPendingCaptures(runtime, completedAt);
  const model = typeof payload.model === 'string' && payload.model.trim() ? payload.model : '';
  const payloadMessages = payloadToMessageSnapshots(payload);
  return runtime.tauriPendingCaptures.find(capture => {
    if (capture.summary.timestamp < completedAt - maxAgeMs) return false;
    if (capture.summary.timestamp > completedAt + 30_000) return false;
    if (model && capture.summary.model !== '当前模型' && capture.summary.model !== model) return false;
    if (payloadMessages.length === 0 || !capture.snapshot?.messages.length) return true;
    return promptSnapshotsMatch(capture.snapshot.messages, payloadMessages);
  }) ?? null;
}

function claimTauriPendingCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown>,
  completedAt?: number,
): PendingCapture | null {
  const timestamp = typeof completedAt === 'number' && Number.isFinite(completedAt) ? completedAt : Date.now();
  pruneTauriPendingCaptures(runtime, timestamp);
  const model = typeof payload.model === 'string' && payload.model.trim() ? payload.model : '';
  const eligibleCaptures = runtime.tauriPendingCaptures
    .map((capture, index) => ({ capture, index }))
    .filter(({ capture }) => {
      if (capture.summary.timestamp > timestamp + 30_000) return false;
      return true;
    });
  const exactMatch = model
    ? eligibleCaptures.find(({ capture }) => {
        if (capture.summary.model === '当前模型') return true;
        return capture.summary.model === model;
      })
    : null;
  const selected = exactMatch ?? eligibleCaptures[0] ?? null;
  if (!selected) return null;
  const [capture] = runtime.tauriPendingCaptures.splice(selected.index, 1);
  return capture ?? null;
}

function promptSnapshotsMatch(left: PromptMessageSnapshot[], right: PromptMessageSnapshot[]): boolean {
  if (left.length !== right.length) return false;
  const firstLeft = left[0];
  const firstRight = right[0];
  const lastLeft = left[left.length - 1];
  const lastRight = right[right.length - 1];
  return firstLeft?.hash === firstRight?.hash && lastLeft?.hash === lastRight?.hash;
}

function forgetTauriPendingCapture(runtime: CacheInspectorMonitorRuntime, id: string): void {
  const index = runtime.tauriPendingCaptures.findIndex(capture => capture.summary.id === id);
  if (index >= 0) runtime.tauriPendingCaptures.splice(index, 1);
}

function pruneTauriPendingCaptures(runtime: CacheInspectorMonitorRuntime, now: number): void {
  const cutoff = now - 15 * 60 * 1000;
  runtime.tauriPendingCaptures = runtime.tauriPendingCaptures.filter(capture => capture.summary.timestamp >= cutoff);
}

function rebaseCaptureIdentity(capture: PendingCapture, id: string, timestamp: number): void {
  capture.summary.id = id;
  capture.summary.timestamp = timestamp;
  if (capture.snapshot) {
    capture.snapshot.id = id;
    capture.snapshot.timestamp = timestamp;
  }
}

async function getTauriLogRawWithRetry(llmApiLogs: TauriLlmApiLogsApi, id: number): Promise<TauriLlmApiLogRaw> {
  let lastError: unknown = null;
  for (const delayMs of [0, 80, 180, 360, 720, 1200]) {
    if (delayMs > 0) await delay(delayMs);
    try {
      const raw = await llmApiLogs.getRaw?.(id);
      if (raw && typeof raw.requestRaw === 'string') return raw;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`无法读取 TauriTavern LLM 日志 ${id}`);
}

function getTauriLlmApiLogsApi(targetWindow: MonitorWindow): TauriLlmApiLogsApi | null {
  try {
    const api = targetWindow.__TAURITAVERN__?.api?.dev?.llmApiLogs;
    if (isRecord(api)) return api as TauriLlmApiLogsApi;
  } catch {
    // 忽略跨窗口访问异常。
  }
  return null;
}

function getTauriInvokeBroker(targetWindow: MonitorWindow): TauriInvokeBroker | null {
  try {
    const broker = targetWindow.__TAURITAVERN__?.invoke?.broker;
    if (isRecord(broker)) return broker as TauriInvokeBroker;
  } catch {
    // 忽略跨窗口访问异常。
  }
  return null;
}

function safeSetTauriInvoke(broker: TauriInvokeBroker, nextInvoke: TauriInvokeFunction): boolean {
  try {
    broker.invoke = nextInvoke;
    return true;
  } catch {
    return false;
  }
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scheduleTauriReadyReinstall(
  runtime: CacheInspectorMonitorRuntime,
  installTargets: () => void,
): void {
  const checkReadyAndReinstall = (): void => {
    if (runtime.destroyed) return;
    installTargets();

    const readyPromise = getTauriReadyPromise();
    if (!readyPromise || readyPromise === runtime.readyPromise) return;
    runtime.readyPromise = readyPromise;

    void Promise.resolve(readyPromise).finally(() => {
      if (!runtime.destroyed) installTargets();
    });
  };

  checkReadyAndReinstall();
  for (const delayMs of [0, 100, 500, 1000, 3000, 8000, 15000]) {
    const timer = setTimeout(checkReadyAndReinstall, delayMs);
    runtime.readyCheckTimers.push(timer);
  }
}

async function hydrateRecordFromResponse(record: CacheSummaryRecord, response: Response): Promise<void> {
  try {
    const text = await response.clone().text();
    await hydrateRecordFromResponseText(record, text);
  } catch (error) {
    await saveCaptureSilently({
      ...record,
      status: 'completed',
      errorMessage: `读取缓存数据失败：${formatError(error)}`,
    });
  }
}

async function hydrateRecordFromResponseText(record: CacheSummaryRecord, text: string): Promise<void> {
  const usage = extractUsageFromResponseText(text);
  await hydrateRecordFromUsage(record, usage);
}

async function hydrateRecordFromResponseValue(
  record: CacheSummaryRecord,
  value: unknown,
  fallbackText?: string | null,
): Promise<void> {
  const usage = extractUsageFromResponseValue(value) ?? (fallbackText ? extractUsageFromResponseText(fallbackText) : null);
  await hydrateRecordFromUsage(record, usage);
}

async function hydrateRecordFromUsage(record: CacheSummaryRecord, usage: Record<string, unknown> | null): Promise<void> {
  const usageSnapshot = usageToSnapshot(usage);
  const pricing = estimateCacheCost(record.model, usageSnapshot);
  const completedRecord = {
    ...record,
    ...usageSnapshot,
    ...pricing,
    status: 'completed',
    errorMessage: usage ? null : '未返回缓存数据',
  } satisfies CacheSummaryRecord;
  await saveCaptureSilently(completedRecord);
  logDiagnostic(safeGlobalMonitorWindow(), 'info', '请求记录已完成', {
    id: completedRecord.id,
    status: completedRecord.status,
    hitTokens: completedRecord.hitTokens,
    missTokens: completedRecord.missTokens,
    outputTokens: completedRecord.outputTokens,
    errorMessage: completedRecord.errorMessage,
  }, true);
}

function shouldCapture(input: RequestInfo | URL | string): boolean {
  const url = typeof input === 'string' ? input : requestUrl(input);
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

function createPendingCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown> | null,
  timestampOverride?: number,
): PendingCapture {
  runtime.requestCounter += 1;
  const timestamp =
    typeof timestampOverride === 'number' && Number.isFinite(timestampOverride) ? timestampOverride : Date.now();
  const id = `cache_${timestamp}_${runtime.requestCounter}`;
  const messages = payloadToMessageSnapshots(payload);
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

function isChatCompletionPayload(payload: Record<string, unknown>): boolean {
  return payloadToMessageSnapshots(payload).length > 0 || typeof payload.model === 'string';
}

function payloadToMessageSnapshots(payload: Record<string, unknown> | null): PromptMessageSnapshot[] {
  if (!payload) return [];
  if (Array.isArray(payload.messages)) return payload.messages.map(messageToSnapshot);

  const snapshots: PromptMessageSnapshot[] = [];
  const systemText = messageContentToText(payload.system ?? payload.systemInstruction ?? payload.system_instruction);
  if (systemText) snapshots.push(createPromptMessageSnapshot('system', systemText));

  if (Array.isArray(payload.input)) {
    snapshots.push(...payload.input.flatMap(responseInputItemToSnapshots));
  } else if (typeof payload.input === 'string') {
    snapshots.push(createPromptMessageSnapshot('user', payload.input));
  }

  if (Array.isArray(payload.contents)) {
    snapshots.push(...payload.contents.map(geminiContentToSnapshot).filter(Boolean));
  }

  return snapshots;
}

function messageToSnapshot(message: unknown): PromptMessageSnapshot {
  const record = isRecord(message) ? message : {};
  const role = typeof record.role === 'string' ? record.role : 'unknown';
  const text = messageContentToText(record.content);
  return createPromptMessageSnapshot(role, text);
}

function responseInputItemToSnapshots(item: unknown): PromptMessageSnapshot[] {
  if (typeof item === 'string') return [createPromptMessageSnapshot('user', item)];
  if (!isRecord(item)) return [];

  const type = typeof item.type === 'string' ? item.type : '';
  const role = typeof item.role === 'string' ? item.role : type === 'output_text' ? 'assistant' : 'user';
  const content = item.content ?? item.text ?? item;
  const text = messageContentToText(content);
  return text ? [createPromptMessageSnapshot(role, text)] : [];
}

function geminiContentToSnapshot(content: unknown): PromptMessageSnapshot | null {
  if (!isRecord(content)) return null;
  const role = typeof content.role === 'string' ? content.role : 'user';
  const normalizedRole = role === 'model' ? 'assistant' : role;
  const text = messageContentToText(content.parts ?? content.content ?? content.text ?? '');
  return text ? createPromptMessageSnapshot(normalizedRole, text) : null;
}

function createPromptMessageSnapshot(role: string, text: string): PromptMessageSnapshot {
  return {
    role,
    text,
    length: text.length,
    hash: createTextHash(text),
  };
}

function messageContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (!isRecord(part)) return '';
        if (
          (part.type === 'text' ||
            part.type === 'input_text' ||
            part.type === 'output_text' ||
            typeof part.type !== 'string') &&
          typeof part.text === 'string'
        ) {
          return part.text;
        }
        if (part.type === 'image_url') return '[image]';
        if (part.inlineData || part.inline_data) return '[image]';
        if (part.type === 'video_url') return '[video]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isRecord(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.input_text === 'string') return content.input_text;
    if (typeof content.output_text === 'string') return content.output_text;
    if (Array.isArray(content.parts)) return messageContentToText(content.parts);
    if (Array.isArray(content.content)) return messageContentToText(content.content);
    if (content.type === 'image_url' || content.image_url || content.inlineData || content.inline_data) return '[image]';
    if (content.type === 'video_url' || content.video_url) return '[video]';
    return '';
  }
  return '';
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

function extractUsageFromResponseValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return extractUsageFromResponseText(value);
  if (!isRecord(value)) return null;
  return extractUsageObject(value);
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
    dispatchRecordsChanged(summary.id, summary);
  } catch (error) {
    console.warn('[缓存命中对比] 保存缓存记录失败', error);
  }
}

function announcePendingCapture(summary: CacheSummaryRecord): void {
  dispatchRecordsChanged(summary.id, summary);
}

function dispatchRecordsChanged(recordId?: string, summary?: CacheSummaryRecord): void {
  const detail = { recordId, summary: cloneSummary(summary) };
  for (const targetWindow of getEventTargetWindows()) {
    try {
      targetWindow.dispatchEvent(createRecordsChangedEvent(targetWindow, detail));
    } catch {
      // 某些跨 realm 的宿主窗口可能拒绝派发事件；其他窗口仍可收到刷新信号。
    }
  }
}

function getEventTargetWindows(): MonitorWindow[] {
  const targets: MonitorWindow[] = [];
  for (const targetWindow of [window, safeRelatedWindow('parent'), safeRelatedWindow('top')]) {
    if (!targetWindow || targets.includes(targetWindow) || !canAccessWindow(targetWindow)) continue;
    targets.push(targetWindow);
  }
  return targets;
}

function createRecordsChangedEvent(
  targetWindow: MonitorWindow,
  detail: { recordId?: string; summary?: CacheSummaryRecord },
): CustomEvent<{ recordId?: string; summary?: CacheSummaryRecord }> {
  const EventConstructor = typeof targetWindow.CustomEvent === 'function' ? targetWindow.CustomEvent : CustomEvent;
  return new EventConstructor(CACHE_RECORDS_CHANGED_EVENT, {
    detail: {
      recordId: detail.recordId,
      summary: cloneSummary(detail.summary),
    },
  }) as CustomEvent<{ recordId?: string; summary?: CacheSummaryRecord }>;
}

function cloneSummary(summary?: CacheSummaryRecord): CacheSummaryRecord | undefined {
  return summary ? { ...summary } : undefined;
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

function getTargetWindows(): MonitorWindow[] {
  const targets: MonitorWindow[] = [];
  for (const targetWindow of [window, safeRelatedWindow('parent'), safeRelatedWindow('top')]) {
    if (!targetWindow || targets.includes(targetWindow)) continue;
    if (!canAccessWindow(targetWindow) || !hasCaptureSurface(targetWindow)) continue;
    targets.push(targetWindow);
  }
  return targets;
}

function hasCaptureSurface(targetWindow: MonitorWindow): boolean {
  return (
    !!safeGetFetch(targetWindow) ||
    getAjaxOwners(targetWindow).some(owner => !!safeGetAjax(owner)) ||
    !!safeGetXMLHttpRequest(targetWindow)
  );
}

function safeRelatedWindow(key: 'parent' | 'top'): MonitorWindow | null {
  try {
    return window[key] as MonitorWindow | null;
  } catch {
    return null;
  }
}

function canAccessWindow(targetWindow: MonitorWindow): boolean {
  try {
    void targetWindow.location.href;
    return true;
  } catch {
    return false;
  }
}

function safeGetFetch(targetWindow: MonitorWindow): typeof fetch | null {
  try {
    return typeof targetWindow.fetch === 'function' ? targetWindow.fetch : null;
  } catch {
    return null;
  }
}

function safeSetFetch(targetWindow: MonitorWindow, nextFetch: typeof fetch): boolean {
  try {
    targetWindow.fetch = nextFetch;
    return true;
  } catch {
    return false;
  }
}

function installFetchAccessor(targetWindow: MonitorWindow, patchState: CacheInspectorPatchState): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(targetWindow, 'fetch');
    if (descriptor && descriptor.configurable === false) return false;

    patchState.fetchOriginalDescriptor = descriptor ?? null;
    Object.defineProperty(targetWindow, 'fetch', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() {
        return patchState.patchedFetch;
      },
      set(nextFetch: typeof fetch) {
        if (typeof nextFetch !== 'function' || nextFetch === patchState.patchedFetch) return;
        patchState.bypassFetch ??= patchState.delegateFetch;
        patchState.delegateFetch = nextFetch.bind(targetWindow);
        logDiagnostic(targetWindow, 'info', 'fetch 被宿主重写，已保持捕获层在最外层', {
          href: safeWindowHref(targetWindow),
        }, true);
      },
    });
    patchState.fetchAccessorInstalled = true;
    return true;
  } catch {
    patchState.fetchAccessorInstalled = false;
    return false;
  }
}

function restoreFetchPatch(targetWindow: MonitorWindow, patchState: CacheInspectorPatchState): void {
  const restoreFetch = patchState.delegateFetch ?? patchState.bypassFetch;
  if (patchState.fetchAccessorInstalled) {
    try {
      delete targetWindow.fetch;
      if (restoreFetch) targetWindow.fetch = restoreFetch;
      return;
    } catch {
      // 继续尝试普通赋值恢复。
    }
  }

  if (safeGetFetch(targetWindow) === patchState.patchedFetch && restoreFetch) {
    safeSetFetch(targetWindow, restoreFetch);
  }
}

async function callFetchDelegate(
  targetWindow: MonitorWindow,
  patchState: CacheInspectorPatchState,
  args: Parameters<typeof fetch>,
): Promise<Response> {
  const delegateFetch = patchState.delegateFetch ?? patchState.bypassFetch ?? targetWindow.fetch.bind(targetWindow);
  patchState.fetchDelegateDepth += 1;
  try {
    return await delegateFetch(...args);
  } finally {
    patchState.fetchDelegateDepth = Math.max(0, patchState.fetchDelegateDepth - 1);
  }
}

function getAjaxOwners(targetWindow: MonitorWindow): JQueryLike[] {
  const owners: JQueryLike[] = [];
  for (const candidate of [safeGetJQueryLike(targetWindow, 'jQuery'), safeGetJQueryLike(targetWindow, '$')]) {
    if (!candidate || owners.includes(candidate)) continue;
    owners.push(candidate);
  }
  return owners;
}

function safeGetJQueryLike(targetWindow: MonitorWindow, key: 'jQuery' | '$'): JQueryLike | null {
  try {
    const value = targetWindow[key];
    return isRecord(value) ? (value as JQueryLike) : null;
  } catch {
    return null;
  }
}

function safeGetAjax(owner: JQueryLike): AjaxFunction | null {
  try {
    return typeof owner.ajax === 'function' ? owner.ajax : null;
  } catch {
    return null;
  }
}

function safeSetAjax(owner: JQueryLike, nextAjax: AjaxFunction): boolean {
  try {
    owner.ajax = nextAjax;
    return true;
  } catch {
    return false;
  }
}

function installAjaxAccessor(targetWindow: MonitorWindow, ajaxPatch: CacheInspectorAjaxPatch): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(ajaxPatch.owner, 'ajax');
    if (descriptor && descriptor.configurable === false) return false;

    ajaxPatch.originalDescriptor = descriptor ?? null;
    Object.defineProperty(ajaxPatch.owner, 'ajax', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() {
        return ajaxPatch.patchedAjax;
      },
      set(nextAjax: AjaxFunction) {
        if (typeof nextAjax !== 'function' || nextAjax === ajaxPatch.patchedAjax) return;
        ajaxPatch.bypassAjax ??= ajaxPatch.delegateAjax;
        ajaxPatch.delegateAjax = nextAjax;
        logDiagnostic(targetWindow, 'info', 'jQuery.ajax 被宿主重写，已保持捕获层在最外层', {
          href: safeWindowHref(targetWindow),
        }, true);
      },
    });
    ajaxPatch.accessorInstalled = true;
    return true;
  } catch {
    ajaxPatch.accessorInstalled = false;
    return false;
  }
}

function restoreAjaxPatch(ajaxPatch: CacheInspectorAjaxPatch): void {
  const restoreAjax = ajaxPatch.delegateAjax ?? ajaxPatch.bypassAjax;
  if (ajaxPatch.accessorInstalled) {
    try {
      delete ajaxPatch.owner.ajax;
      if (restoreAjax) ajaxPatch.owner.ajax = restoreAjax;
      return;
    } catch {
      // 继续尝试普通赋值恢复。
    }
  }

  if (safeGetAjax(ajaxPatch.owner) === ajaxPatch.patchedAjax && restoreAjax) {
    safeSetAjax(ajaxPatch.owner, restoreAjax);
  }
}

function callAjaxDelegate(ajaxPatch: CacheInspectorAjaxPatch, thisArg: unknown, args: unknown[]): unknown {
  const delegateAjax = ajaxPatch.delegateAjax ?? ajaxPatch.bypassAjax;
  ajaxPatch.ajaxDelegateDepth += 1;
  try {
    return delegateAjax.apply(thisArg, args);
  } finally {
    ajaxPatch.ajaxDelegateDepth = Math.max(0, ajaxPatch.ajaxDelegateDepth - 1);
  }
}

function safeGetXMLHttpRequest(targetWindow: MonitorWindow): typeof XMLHttpRequest | null {
  try {
    return typeof targetWindow.XMLHttpRequest === 'function' ? targetWindow.XMLHttpRequest : null;
  } catch {
    return null;
  }
}

function safeSetXMLHttpRequest(targetWindow: MonitorWindow, nextXMLHttpRequest: typeof XMLHttpRequest): boolean {
  try {
    targetWindow.XMLHttpRequest = nextXMLHttpRequest;
    return true;
  } catch {
    return false;
  }
}

function copyXMLHttpRequestStatics(target: typeof XMLHttpRequest, source: typeof XMLHttpRequest): void {
  for (const key of ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'] as const) {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value: source[key],
      });
    } catch {
      // 某些宿主不允许重定义静态常量，忽略即可。
    }
  }
}

function getAjaxRequestDetails(args: unknown[]): { url: string; payload: Record<string, unknown> | null } | null {
  const firstArg = args[0];
  const settings = typeof firstArg === 'string' ? (isRecord(args[1]) ? args[1] : null) : isRecord(firstArg) ? firstArg : null;
  const url = typeof firstArg === 'string' ? firstArg : typeof settings?.url === 'string' ? settings.url : null;
  if (!url) return null;

  return {
    url,
    payload: parseAjaxPayload(settings?.data),
  };
}

function parseAjaxPayload(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') return parseJsonObject(data);
  if (isRecord(data)) return data;
  return null;
}

function attachAjaxCompletionHandlers(record: CacheSummaryRecord, result: unknown): void {
  if (!isRecord(result)) return;

  if (typeof result.done === 'function') {
    result.done((data: unknown, _textStatus: unknown, jqXHR: unknown) => {
      void hydrateRecordFromResponseValue(record, data, ajaxResponseText(jqXHR));
    });
    if (typeof result.fail === 'function') {
      result.fail((jqXHR: unknown, _textStatus: unknown, errorThrown: unknown) => {
        void saveCaptureSilently({
          ...record,
          status: 'failed',
          errorMessage: formatAjaxError(jqXHR, errorThrown),
        });
      });
    }
    return;
  }

  if (typeof result.then === 'function') {
    void Promise.resolve(result).then(
      value => hydrateRecordFromResponseValue(record, value),
      error =>
        saveCaptureSilently({
          ...record,
          status: 'failed',
          errorMessage: formatError(error),
        }),
    );
  }
}

function attachAjaxFailureHandler(
  record: CacheSummaryRecord,
  result: unknown,
  beforeSaveFailed?: () => void,
): void {
  if (!isRecord(result)) return;

  const saveFailed = (message: string): void => {
    beforeSaveFailed?.();
    void saveCaptureSilently({
      ...record,
      status: 'failed',
      errorMessage: message,
    });
  };

  if (typeof result.fail === 'function') {
    result.fail((jqXHR: unknown, _textStatus: unknown, errorThrown: unknown) => {
      saveFailed(formatAjaxError(jqXHR, errorThrown));
    });
    return;
  }

  if (typeof result.then === 'function') {
    void Promise.resolve(result).catch(error => saveFailed(formatError(error)));
  }
}

function ajaxResponseText(jqXHR: unknown): string | null {
  return isRecord(jqXHR) && typeof jqXHR.responseText === 'string' ? jqXHR.responseText : null;
}

function getTauriReadyPromise(): PromiseLike<unknown> | null {
  for (const targetWindow of getTargetWindows()) {
    const readyPromise = targetWindow.__TAURITAVERN__?.ready ?? targetWindow.__TAURITAVERN_MAIN_READY__;
    if (isPromiseLike(readyPromise)) return readyPromise;
  }
  return null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

function installDiagnostics(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  if (typeof targetWindow.__wbmCacheInspectorDiagnostics === 'function') return;
  try {
    targetWindow.__wbmCacheInspectorDiagnostics = () => collectDiagnostics(runtime, targetWindow);
  } catch {
    // 诊断入口只是辅助，不影响捕获。
  }
}

function collectDiagnostics(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): CacheInspectorDiagnostics {
  const patchState = targetWindow.__wbmCacheInspectorPatchState;
  return {
    href: safeWindowHref(targetWindow),
    fetch: {
      installed: !!patchState?.patchedFetch,
      currentIsPatched: !!patchState?.patchedFetch && safeGetFetch(targetWindow) === patchState.patchedFetch,
      hasDelegate: !!patchState?.delegateFetch,
      hasBypass: !!patchState?.bypassFetch,
    },
    ajax: (patchState?.ajaxPatches ?? []).map(ajaxPatch => ({
      installed: !!ajaxPatch.patchedAjax,
      currentIsPatched: safeGetAjax(ajaxPatch.owner) === ajaxPatch.patchedAjax,
      hasDelegate: !!ajaxPatch.delegateAjax,
      hasBypass: !!ajaxPatch.bypassAjax,
    })),
    xhr: {
      installed: !!patchState?.patchedXMLHttpRequest,
      currentIsPatched:
        !!patchState?.patchedXMLHttpRequest && safeGetXMLHttpRequest(targetWindow) === patchState.patchedXMLHttpRequest,
    },
    tauriNativeLog: {
      active: runtime.tauriNativeLogActive,
      subscriptions: runtime.tauriLogUnsubscribers.length,
      processedIds: runtime.tauriLogProcessedIds.size,
    },
  };
}

function captureLogDetails(record: CacheSummaryRecord): Record<string, unknown> {
  return {
    id: record.id,
    model: record.model,
    messageCount: record.messageCount,
    promptChars: record.promptChars,
  };
}

function logDiagnostic(
  targetWindow: MonitorWindow | null,
  level: 'debug' | 'info' | 'warn',
  message: string,
  details?: Record<string, unknown>,
  force = false,
): void {
  if (!force && !isDiagnosticLoggingEnabled(targetWindow)) return;
  const consoleLike = globalThis.console;
  const method = consoleLike?.[level] ?? consoleLike?.log;
  if (typeof method !== 'function') return;
  if (details) {
    method.call(consoleLike, `[缓存命中对比] ${message}`, details);
    return;
  }
  method.call(consoleLike, `[缓存命中对比] ${message}`);
}

function isDiagnosticLoggingEnabled(targetWindow: MonitorWindow | null): boolean {
  if (!targetWindow) return false;
  try {
    if (targetWindow.__WBM_CACHE_INSPECTOR_DEBUG__) return true;
  } catch {
    return false;
  }
  try {
    return targetWindow.localStorage?.getItem('worldbookCacheInspectorDebug') === '1';
  } catch {
    return false;
  }
}

function safeGlobalMonitorWindow(): MonitorWindow | null {
  try {
    return typeof window === 'undefined' ? null : (window as MonitorWindow);
  } catch {
    return null;
  }
}

function safeWindowHref(targetWindow: MonitorWindow): string | null {
  try {
    return targetWindow.location.href;
  } catch {
    return null;
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function formatAjaxError(jqXHR: unknown, errorThrown: unknown): string {
  if (errorThrown) return formatError(errorThrown);
  if (isRecord(jqXHR) && typeof jqXHR.statusText === 'string') return jqXHR.statusText;
  return 'jQuery.ajax 请求失败';
}
