import { createTextHash } from './diff';
import { refreshUsdToCnyRate } from './exchange-rate';
import { estimateCacheCost } from './pricing';
import { listCacheSummaries, saveCacheCapture } from './storage';
import type { CacheSummaryRecord, CacheUsageSnapshot, PromptMessageSnapshot, PromptSnapshotRecord } from './types';

const TARGET_API = '/api/backends/chat-completions/generate';
const TAURI_VISIBLE_RESPONSE_FALLBACK_DELAY_MS = 500;
const TAURI_PENDING_CAPTURE_MAX_AGE_MS = 30 * 60 * 1000;
const TAURI_VISIBLE_RESPONSE_FALLBACK_TTL_MS = 2 * 60 * 1000;
const TAURI_STORED_PENDING_LOOSE_MATCH_MAX_AGE_MS = 5 * 60 * 1000;
const TAURI_LOG_INDEX_POLL_LIMIT = 40;
const TAURI_LOG_INDEX_MAX_RAW_READS_PER_POLL = 2;
const TAURI_LOG_LOW_KEEP_WARNING_THRESHOLD = 20;
const TAURI_LOG_INDEX_BUSY_POLL_INTERVAL_MS = 500;
const TAURI_LOG_INDEX_IDLE_POLL_INTERVAL_MS = 1000;
const TAURI_LOG_INDEX_HISTORY_GRACE_MS = 5_000;
const MONITOR_WATCHDOG_INTERVAL_MS = 500;
const CACHE_INSPECTOR_TRACE_LIMIT = 300;
const HOST_FUNCTION_CAPTURE_STORAGE_KEY = 'worldbookCacheInspectorHostFunctionCapture';
const NO_CACHE_USAGE_MESSAGE = '无缓存明细';
const LEGACY_NO_CACHE_USAGE_MESSAGE = '未返回缓存数据';
export const CACHE_RECORDS_CHANGED_EVENT = 'worldbook-manager:cache-records-changed';

type MonitorWindow = Window &
  typeof globalThis & {
    __wbmCacheInspectorPatchState?: CacheInspectorPatchState;
    __wbmCacheInspectorDiagnostics?: () => CacheInspectorDiagnostics;
    __wbmCacheInspectorTrace?: CacheInspectorTraceEntry[];
    __wbmCacheInspectorTraceDump?: () => CacheInspectorTraceEntry[];
    __WBM_CACHE_INSPECTOR_DEBUG__?: boolean;
    __WBM_CACHE_INSPECTOR_HOST_FUNCTION_CAPTURE__?: boolean;
    $?: JQueryLike;
    jQuery?: JQueryLike;
    XMLHttpRequest?: typeof XMLHttpRequest;
    TavernHelper?: TavernHelperApi | null;
    SillyTavern?: SillyTavernApi | null;
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

type HostCaptureFunction = (this: unknown, ...args: unknown[]) => unknown;

type HostFunctionOwner = Record<string, unknown>;

type HostFunctionPatch = {
  owner: HostFunctionOwner;
  key: string;
  originalFunction: HostCaptureFunction;
  patchedFunction: HostCaptureFunction;
};

type TavernHelperApi = HostFunctionOwner & {
  generateRaw?: HostCaptureFunction;
};

type SillyTavernApi = {
  getContext?: () => unknown;
};

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
  getKeep?: () => PromiseLike<number>;
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
  fallbackAt?: number;
  hostCompletionHandled?: boolean;
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
  captureTauriVisibleResponseFallback: boolean;
  requestCounter: number;
  targetWindows: Set<MonitorWindow>;
  readyPromise: PromiseLike<unknown> | null;
  readyCheckTimers: ReturnType<typeof setTimeout>[];
  watchdogTimer: ReturnType<typeof setInterval> | null;
  tauriLogApis: Set<TauriLlmApiLogsApi>;
  tauriLogProcessedIds: Set<number>;
  tauriLogProcessingIds: Set<number>;
  tauriLogRetryIds: Set<number>;
  tauriStoredPendingClaimIds: Set<string>;
  tauriLogIndexPollTimes: Map<TauriLlmApiLogsApi, number>;
  tauriLogIndexPollInFlight: Set<TauriLlmApiLogsApi>;
  tauriLogMonitorStartedAt: number;
  tauriLogUnsubscribers: Array<() => void | PromiseLike<void>>;
  tauriHostDetected: boolean;
  tauriNativeLogActive: boolean;
  tauriPendingCaptures: PendingCapture[];
  tauriVisibleResponseFallbackCaptures: PendingCapture[];
  tauriInvokeBrokerPatches: TauriInvokeBrokerPatch[];
  hostFunctionPatches: HostFunctionPatch[];
  hostPendingCaptures: PendingCapture[];
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
    hostDetected: boolean;
    apis: number;
    subscriptions: number;
    processedIds: number;
    processingIds: number;
    retryIds: number;
    indexPollInFlight: number;
    pendingCaptures: number;
    fallbackCaptures: number;
  };
};

type CacheInspectorTraceEntry = {
  at: string;
  ms: number;
  stage: string;
  details?: Record<string, unknown>;
};

export type CacheInspectorMonitorHandle = {
  destroy: () => void;
};

export type CacheInspectorMonitorOptions = {
  captureTauriVisibleResponseFallback?: boolean;
};

export function cleanupCacheInspectorMonitorPatches(): void {
  for (const targetWindow of getTargetWindows()) {
    forceReleaseTargetWindow(targetWindow);
  }
}

export function installCacheInspectorMonitor(options: CacheInspectorMonitorOptions = {}): CacheInspectorMonitorHandle {
  const runtime: CacheInspectorMonitorRuntime = {
    destroyed: false,
    captureTauriVisibleResponseFallback: options.captureTauriVisibleResponseFallback ?? true,
    requestCounter: 0,
    targetWindows: new Set(),
    readyPromise: null,
    readyCheckTimers: [],
    watchdogTimer: null,
    tauriLogApis: new Set(),
    tauriLogProcessedIds: new Set(),
    tauriLogProcessingIds: new Set(),
    tauriLogRetryIds: new Set(),
    tauriStoredPendingClaimIds: new Set(),
    tauriLogIndexPollTimes: new Map(),
    tauriLogIndexPollInFlight: new Set(),
    tauriLogMonitorStartedAt: Date.now(),
    tauriLogUnsubscribers: [],
    tauriHostDetected: false,
    tauriNativeLogActive: false,
    tauriPendingCaptures: [],
    tauriVisibleResponseFallbackCaptures: [],
    tauriInvokeBrokerPatches: [],
    hostFunctionPatches: [],
    hostPendingCaptures: [],
  };

  const installTargets = (): void => {
    if (runtime.destroyed) return;
    const targetWindows = getTargetWindows();
    for (const targetWindow of targetWindows) {
      markTauriNativeLogHost(runtime, targetWindow);
    }
    for (const targetWindow of targetWindows) {
      retainTargetWindow(runtime, targetWindow);
      patchTargetWindow(runtime, targetWindow);
    }
    installTauriNativeLogMonitor(runtime);
    installTauriInvokeBrokerMonitor(runtime);
  };

  installTargets();
  traceCacheInspector(safeGlobalMonitorWindow(), 'monitor.install', {
    targetWindows: runtime.targetWindows.size,
  });
  void refreshUsdToCnyRate();
  scheduleTauriReadyReinstall(runtime, installTargets);
  runtime.watchdogTimer = setInterval(installTargets, MONITOR_WATCHDOG_INTERVAL_MS);

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
      for (const functionPatch of runtime.hostFunctionPatches.splice(0)) {
        restoreHostFunctionPatch(functionPatch);
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

function forceReleaseTargetWindow(targetWindow: MonitorWindow): void {
  const patchState = targetWindow.__wbmCacheInspectorPatchState;
  if (!patchState) return;
  patchState.installCount = 1;
  releaseTargetWindow(targetWindow);
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
  markTauriNativeLogHost(runtime, targetWindow);
  patchFetchTargetWindow(runtime, targetWindow);
  patchAjaxTargetWindow(runtime, targetWindow);
  patchXMLHttpRequestTargetWindow(runtime, targetWindow);
  if (!runtime.tauriHostDetected && shouldPatchHostFunctions(targetWindow)) {
    patchTavernHelperTargetWindow(runtime, targetWindow);
    patchSillyTavernServiceTargetWindow(runtime, targetWindow);
  }
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
    const hostCapture = claimHostPendingCapture(runtime, payload);
    const capture = hostCapture ?? createPendingCapture(runtime, payload);
    logDiagnostic(targetWindow, 'info', 'fetch 捕获生成请求', captureLogDetails(capture.summary), true);
    if (runtime.tauriNativeLogActive) {
      queueTauriPendingCapture(runtime, capture);
      try {
        const response = await callFetchDelegate(targetWindow, patchState, args);
        scheduleTauriVisibleResponseFallback(
          runtime,
          capture,
          runtime.captureTauriVisibleResponseFallback ? createResponseTextPromise(response) : Promise.resolve(''),
        );
        return response;
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
      void hydrateRecordFromResponse(capture.summary, response, capture.snapshot);
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
    const hostCapture = claimHostPendingCapture(runtime, request.payload);
    const capture = hostCapture ?? createPendingCapture(runtime, request.payload);
    logDiagnostic(targetWindow, 'info', 'jQuery.ajax 捕获生成请求', captureLogDetails(capture.summary), true);
    if (runtime.tauriNativeLogActive) {
      queueTauriPendingCapture(runtime, capture);
      try {
        const result = callAjaxDelegate(ajaxPatch, this, args);
        attachAjaxTauriCompletionHandlers(runtime, capture, result, runtime.captureTauriVisibleResponseFallback);
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
      attachAjaxCompletionHandlers(capture.summary, result, capture.snapshot);
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
        const payload = parseAjaxPayload(body);
        const hostCapture = claimHostPendingCapture(runtime, payload);
        const capture = hostCapture ?? createPendingCapture(runtime, payload);
        logDiagnostic(targetWindow, 'info', 'XMLHttpRequest 捕获生成请求', captureLogDetails(capture.summary), true);
        if (runtime.tauriNativeLogActive) queueTauriPendingCapture(runtime, capture);
        xhr.addEventListener(
          'loadend',
          () => {
            if (xhr.status >= 200 && xhr.status < 400) {
              if (runtime.tauriNativeLogActive) {
                scheduleTauriVisibleResponseFallback(
                  runtime,
                  capture,
                  Promise.resolve(runtime.captureTauriVisibleResponseFallback ? xhr.responseText || '' : ''),
                );
                return;
              }
              void hydrateRecordFromResponseText(capture.summary, xhr.responseText || '', capture.snapshot);
              return;
            }
            if (runtime.tauriNativeLogActive) forgetTauriPendingCapture(runtime, capture.summary.id);
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

function patchTavernHelperTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  const helper = safeGetTavernHelper(targetWindow);
  if (!helper || typeof helper.generateRaw !== 'function') return;

  installHostFunctionPatch(runtime, helper, 'generateRaw', originalFunction =>
    createPatchedTavernHelperGenerateRaw(runtime, targetWindow, originalFunction),
  );
}

function patchSillyTavernServiceTargetWindow(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): void {
  const context = safeGetSillyTavernContext(targetWindow);
  if (!context) return;

  const connectionManager = getRecordProperty(context, 'ConnectionManagerRequestService');
  if (connectionManager && typeof connectionManager.sendRequest === 'function') {
    installHostFunctionPatch(runtime, connectionManager, 'sendRequest', originalFunction =>
      createPatchedConnectionManagerSendRequest(runtime, targetWindow, originalFunction),
    );
  }

  const chatCompletionService = getRecordProperty(context, 'ChatCompletionService');
  if (chatCompletionService && typeof chatCompletionService.processRequest === 'function') {
    installHostFunctionPatch(runtime, chatCompletionService, 'processRequest', originalFunction =>
      createPatchedCompletionServiceProcessRequest(runtime, targetWindow, originalFunction, 'chat-completion-service'),
    );
  }

  const textCompletionService = getRecordProperty(context, 'TextCompletionService');
  if (textCompletionService && typeof textCompletionService.processRequest === 'function') {
    installHostFunctionPatch(runtime, textCompletionService, 'processRequest', originalFunction =>
      createPatchedCompletionServiceProcessRequest(runtime, targetWindow, originalFunction, 'text-completion-service'),
    );
  }
}

function installHostFunctionPatch(
  runtime: CacheInspectorMonitorRuntime,
  owner: HostFunctionOwner,
  key: string,
  createPatchedFunction: (originalFunction: HostCaptureFunction) => HostCaptureFunction,
): void {
  const currentFunction = owner[key];
  if (typeof currentFunction !== 'function') return;

  const existingPatch = runtime.hostFunctionPatches.find(patch => patch.owner === owner && patch.key === key);
  if (existingPatch) {
    if (currentFunction === existingPatch.patchedFunction) return;
    existingPatch.originalFunction = currentFunction as HostCaptureFunction;
    existingPatch.patchedFunction = createPatchedFunction(existingPatch.originalFunction);
    safeSetHostFunction(owner, key, existingPatch.patchedFunction);
    return;
  }

  const originalFunction = currentFunction as HostCaptureFunction;
  const patch: HostFunctionPatch = {
    owner,
    key,
    originalFunction,
    patchedFunction: createPatchedFunction(originalFunction),
  };
  if (!safeSetHostFunction(owner, key, patch.patchedFunction)) return;
  runtime.hostFunctionPatches.push(patch);
}

function createPatchedTavernHelperGenerateRaw(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  originalFunction: HostCaptureFunction,
): HostCaptureFunction {
  return function patchedTavernHelperGenerateRaw(this: unknown, ...args: unknown[]): unknown {
    const payload = tavernHelperGenerateRawArgsToPayload(args);
    const capture = createPendingCapture(runtime, payload);
    logDiagnostic(targetWindow, 'info', 'TavernHelper.generateRaw 捕获生成请求', captureLogDetails(capture.summary), true);
    return captureHostFunctionResult(runtime, capture, () => originalFunction.apply(this, args));
  };
}

function createPatchedConnectionManagerSendRequest(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  originalFunction: HostCaptureFunction,
): HostCaptureFunction {
  return function patchedConnectionManagerSendRequest(this: unknown, ...args: unknown[]): unknown {
    const payload = connectionManagerSendRequestArgsToPayload(args);
    const capture = createPendingCapture(runtime, payload);
    logDiagnostic(
      targetWindow,
      'info',
      'ConnectionManagerRequestService.sendRequest 捕获生成请求',
      captureLogDetails(capture.summary),
      true,
    );
    return captureHostFunctionResult(runtime, capture, () => originalFunction.apply(this, args));
  };
}

function createPatchedCompletionServiceProcessRequest(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  originalFunction: HostCaptureFunction,
  source: string,
): HostCaptureFunction {
  return function patchedCompletionServiceProcessRequest(this: unknown, ...args: unknown[]): unknown {
    if (hasMatchingHostCapture(runtime, serviceProcessRequestArgsToPayload(args))) {
      return originalFunction.apply(this, args);
    }

    const payload = serviceProcessRequestArgsToPayload(args);
    const capture = createPendingCapture(runtime, payload);
    logDiagnostic(targetWindow, 'info', `${source} 捕获生成请求`, captureLogDetails(capture.summary), true);
    return captureHostFunctionResult(runtime, capture, () => originalFunction.apply(this, args));
  };
}

function captureHostFunctionResult(
  runtime: CacheInspectorMonitorRuntime,
  capture: PendingCapture,
  callOriginal: () => unknown,
): unknown {
  queueHostPendingCapture(runtime, capture);
  if (runtime.tauriNativeLogActive) queueTauriPendingCapture(runtime, capture);

  let result: unknown;
  try {
    result = callOriginal();
  } catch (error) {
    forgetHostPendingCapture(runtime, capture.summary.id);
    forgetTauriPendingCapture(runtime, capture.summary.id);
    void saveCaptureSilently({
      ...capture.summary,
      status: 'failed',
      errorMessage: formatError(error),
    });
    throw error;
  }

  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(
      value => completeHostFunctionCapture(runtime, capture, value),
      error => {
        forgetHostPendingCapture(runtime, capture.summary.id);
        forgetTauriPendingCapture(runtime, capture.summary.id);
        void saveCaptureSilently({
          ...capture.summary,
          status: 'failed',
          errorMessage: formatError(error),
        });
        throw error;
      },
    );
  }

  void completeHostFunctionCapture(runtime, capture, result);
  return result;
}

async function completeHostFunctionCapture(
  runtime: CacheInspectorMonitorRuntime,
  capture: PendingCapture,
  value: unknown,
): Promise<unknown> {
  forgetHostPendingCapture(runtime, capture.summary.id);
  if (capture.hostCompletionHandled) return value;

  if (typeof value === 'function') {
    return wrapStreamFactoryResult(runtime, capture, value as (...args: unknown[]) => unknown);
  }

  if (runtime.tauriNativeLogActive) {
    scheduleTauriVisibleResponseFallback(runtime, capture, Promise.resolve(safeStringify(value) ?? ''));
    return value;
  }

  await hydrateRecordFromResponseValue(capture.summary, value, safeStringify(value), capture.snapshot);
  return value;
}

function wrapStreamFactoryResult(
  runtime: CacheInspectorMonitorRuntime,
  capture: PendingCapture,
  streamFactory: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  return function patchedStreamFactory(this: unknown, ...args: unknown[]): unknown {
    const stream = streamFactory.apply(this, args);
    if (!isAsyncIterable(stream)) return stream;
    return wrapAsyncIterable(runtime, capture, stream);
  };
}

async function* wrapAsyncIterable(
  runtime: CacheInspectorMonitorRuntime,
  capture: PendingCapture,
  stream: AsyncIterable<unknown>,
): AsyncGenerator<unknown> {
  let lastValue: unknown = null;
  try {
    for await (const value of stream) {
      lastValue = value;
      yield value;
    }
    if (runtime.tauriNativeLogActive) {
      scheduleTauriVisibleResponseFallback(runtime, capture, Promise.resolve(safeStringify(lastValue) ?? ''));
    } else {
      await hydrateRecordFromResponseValue(capture.summary, lastValue, safeStringify(lastValue), capture.snapshot);
    }
  } catch (error) {
    forgetTauriPendingCapture(runtime, capture.summary.id);
    await saveCaptureSilently({
      ...capture.summary,
      status: 'failed',
      errorMessage: formatError(error),
    });
    throw error;
  }
}

function installTauriNativeLogMonitor(runtime: CacheInspectorMonitorRuntime): void {
  for (const targetWindow of getTargetWindows()) {
    markTauriNativeLogHost(runtime, targetWindow);
    const llmApiLogs = getTauriLlmApiLogsApi(targetWindow);
    if (!llmApiLogs) continue;
    reportTauriLlmApiLogKeep(targetWindow, llmApiLogs);
    if (runtime.tauriLogApis.has(llmApiLogs)) {
      pollTauriNativeLogIndexIfNeeded(runtime, targetWindow, llmApiLogs);
      continue;
    }
    if (typeof llmApiLogs.getRaw !== 'function') continue;

    runtime.tauriLogApis.add(llmApiLogs);
    runtime.tauriNativeLogActive = true;
    traceCacheInspector(targetWindow, 'tt.log.api.detected', {
      href: safeWindowHref(targetWindow),
      hasIndex: typeof llmApiLogs.index === 'function',
      hasSubscribeIndex: typeof llmApiLogs.subscribeIndex === 'function',
      hasKeepApi: typeof llmApiLogs.getKeep === 'function',
      ...tauriRuntimeTraceDetails(runtime),
    });
    void startTauriNativeLogMonitor(runtime, targetWindow, llmApiLogs);
  }
}

function pollTauriNativeLogIndexIfNeeded(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  llmApiLogs: TauriLlmApiLogsApi,
): void {
  if (typeof llmApiLogs.index !== 'function') return;

  const hasPollingWork = hasTauriLogPollingWork(runtime);
  const now = Date.now();
  const lastPolledAt = runtime.tauriLogIndexPollTimes.get(llmApiLogs) ?? 0;
  const pollInterval = hasPollingWork ? TAURI_LOG_INDEX_BUSY_POLL_INTERVAL_MS : TAURI_LOG_INDEX_IDLE_POLL_INTERVAL_MS;
  if (now - lastPolledAt < pollInterval) return;
  runtime.tauriLogIndexPollTimes.set(llmApiLogs, now);
  traceCacheInspector(targetWindow, 'tt.log.index.poll.schedule', {
    intervalMs: pollInterval,
    hasPollingWork,
    ...tauriRuntimeTraceDetails(runtime),
  });
  void pollTauriNativeLogIndex(runtime, targetWindow, llmApiLogs);
}

async function pollTauriNativeLogIndex(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  llmApiLogs: TauriLlmApiLogsApi,
): Promise<void> {
  if (typeof llmApiLogs.index !== 'function') return;
  if (runtime.tauriLogIndexPollInFlight.has(llmApiLogs)) return;
  const hasPollingWork = hasTauriLogPollingWork(runtime);
  runtime.tauriLogIndexPollInFlight.add(llmApiLogs);
  try {
    const storedClaimCandidates = hasPollingWork
      ? []
      : await listStoredTauriClaimableSummaries(runtime, targetWindow);
    const shouldRecoverStoredRecords = storedClaimCandidates.length > 0;
    const entries = await llmApiLogs.index({
      limit: hasPollingWork || shouldRecoverStoredRecords ? TAURI_LOG_INDEX_POLL_LIMIT : 20,
    });
    traceCacheInspector(targetWindow, 'tt.log.index.poll.result', {
      count: entries.length,
      ids: entries.map(entry => entry.id).filter(id => typeof id === 'number').slice(0, 20),
      storedClaimCandidates: storedClaimCandidates.length,
      ...tauriRuntimeTraceDetails(runtime),
    });
    let rawReadsScheduled = 0;
    for (const entry of entries) {
      if (!shouldProcessTauriLogIndexEntry(runtime, targetWindow, entry, hasPollingWork, storedClaimCandidates)) {
        continue;
      }
      await captureTauriLlmApiLog(runtime, targetWindow, llmApiLogs, entry);
      rawReadsScheduled += 1;
      if (rawReadsScheduled >= TAURI_LOG_INDEX_MAX_RAW_READS_PER_POLL) break;
    }
  } catch (error) {
    logDiagnostic(targetWindow, 'debug', '轮询 TauriTavern 原生 LLM 日志索引失败', {
      error: formatError(error),
    }, true);
  } finally {
    runtime.tauriLogIndexPollInFlight.delete(llmApiLogs);
  }
}

function shouldProcessTauriLogIndexEntry(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
  entry: TauriLlmApiLogIndexEntry,
  allowHistoricalEntry: boolean,
  storedClaimCandidates: CacheSummaryRecord[],
): boolean {
  const logId = normalizePositiveInteger(entry.id);
  if (logId && runtime.tauriLogProcessedIds.has(logId)) return false;
  if (allowHistoricalEntry) return true;
  const timestampMs = typeof entry.timestampMs === 'number' && Number.isFinite(entry.timestampMs)
    ? entry.timestampMs
    : null;
  if (timestampMs === null || timestampMs >= runtime.tauriLogMonitorStartedAt - TAURI_LOG_INDEX_HISTORY_GRACE_MS) {
    return true;
  }
  if (hasStoredTauriClaimCandidateForLogEntry(storedClaimCandidates, entry, timestampMs)) return true;
  if (logId) runtime.tauriLogProcessedIds.add(logId);
  traceCacheInspector(targetWindow, 'tt.log.index.skip.historical', {
    logId,
    timestampMs,
    monitorStartedAt: runtime.tauriLogMonitorStartedAt,
  });
  return false;
}

async function listStoredTauriClaimableSummaries(
  runtime: CacheInspectorMonitorRuntime,
  targetWindow: MonitorWindow,
): Promise<CacheSummaryRecord[]> {
  try {
    return (await listCacheSummaries())
      .filter(isClaimableStoredTauriSummary)
      .filter(record => !runtime.tauriStoredPendingClaimIds.has(record.id));
  } catch (error) {
    traceCacheInspector(targetWindow, 'tt.log.stored-pending.poll-lookup.failed', {
      error: formatError(error),
    });
    return [];
  }
}

function hasStoredTauriClaimCandidateForLogEntry(
  candidates: CacheSummaryRecord[],
  entry: TauriLlmApiLogIndexEntry,
  timestampMs: number,
): boolean {
  if (candidates.length === 0) return false;
  const model = typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : '';
  return candidates.some(record => {
    if (model && record.model !== model && record.model !== '当前模型') return false;
    return isStoredTauriPendingInTimeWindow(record, timestampMs);
  });
}

function hasTauriLogPollingWork(runtime: CacheInspectorMonitorRuntime): boolean {
  return (
    runtime.tauriPendingCaptures.length > 0 ||
    runtime.tauriVisibleResponseFallbackCaptures.length > 0 ||
    runtime.tauriLogRetryIds.size > 0
  );
}

function reportTauriLlmApiLogKeep(targetWindow: MonitorWindow, llmApiLogs: TauriLlmApiLogsApi): void {
  if (typeof llmApiLogs.getKeep !== 'function') return;
  const reportedKeys = ((targetWindow as MonitorWindow & { __wbmCacheInspectorReportedTauriKeeps?: WeakSet<object> })
    .__wbmCacheInspectorReportedTauriKeeps ??= new WeakSet<object>());
  if (reportedKeys.has(llmApiLogs as object)) return;
  reportedKeys.add(llmApiLogs as object);

  void (async () => {
    try {
      const keep = normalizePositiveInteger(await llmApiLogs.getKeep?.());
      traceCacheInspector(targetWindow, 'tt.log.keep.report', {
        keep: keep ?? null,
      });
      if (keep && keep < TAURI_LOG_LOW_KEEP_WARNING_THRESHOLD) {
        logDiagnostic(targetWindow, 'warn', 'TauriTavern LLM API 日志保留数偏低，快速连续请求可能来不及回填', {
          keep,
          recommendedAtLeast: TAURI_LOG_LOW_KEEP_WARNING_THRESHOLD,
        }, true);
      }
    } catch (error) {
      traceCacheInspector(targetWindow, 'tt.log.keep.report.failed', {
        error: formatError(error),
      });
    }
  })();
}

function installTauriInvokeBrokerMonitor(runtime: CacheInspectorMonitorRuntime): void {
  for (const targetWindow of getTargetWindows()) {
    markTauriNativeLogHost(runtime, targetWindow);
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
          void hydrateRecordFromResponseValue(capture.summary, value, safeStringify(value), capture.snapshot);
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
  traceCacheInspector(targetWindow, 'tt.invoke.pending.created', {
    command: normalizedCommand,
    ...captureLogDetails(capture.summary),
    ...tauriRuntimeTraceDetails(runtime),
  });
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

    await pollTauriNativeLogIndex(runtime, targetWindow, llmApiLogs);
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
  if (!logId) {
    traceCacheInspector(targetWindow, 'tt.log.entry.skip.invalid-id', { entryId: entry.id });
    return;
  }
  if (runtime.tauriLogProcessedIds.has(logId)) {
    traceCacheInspector(targetWindow, 'tt.log.entry.skip.processed', { logId, ...tauriRuntimeTraceDetails(runtime) });
    return;
  }
  if (runtime.tauriLogProcessingIds.has(logId)) {
    traceCacheInspector(targetWindow, 'tt.log.entry.skip.processing', { logId, ...tauriRuntimeTraceDetails(runtime) });
    return;
  }
  if (typeof llmApiLogs.getRaw !== 'function') {
    traceCacheInspector(targetWindow, 'tt.log.entry.skip.no-getRaw', { logId });
    return;
  }

  runtime.tauriLogProcessingIds.add(logId);
  traceCacheInspector(targetWindow, 'tt.log.entry.processing', {
    logId,
    timestampMs: entry.timestampMs ?? null,
    ok: entry.ok ?? null,
    stream: entry.stream ?? null,
    ...tauriRuntimeTraceDetails(runtime),
  });
  try {
    const raw = await getTauriLogRawWithRetry(llmApiLogs, logId, targetWindow);
    const payload = parseJsonObject(raw.requestRaw ?? '');
    if (!payload || !isChatCompletionPayload(payload)) {
      runtime.tauriLogProcessedIds.add(logId);
      runtime.tauriLogRetryIds.delete(logId);
      traceCacheInspector(targetWindow, 'tt.log.raw.skip.non-chat-payload', {
        logId,
        hasRequestRaw: typeof raw.requestRaw === 'string',
      });
      return;
    }

    const responseValue = raw.responseRawKind === 'json' ? parseJsonObject(raw.responseRaw ?? '') : null;
    const responseUsage =
      raw.responseRawKind === 'json'
        ? extractUsageFromResponseValue(responseValue) ?? extractUsageFromResponseText(raw.responseRaw ?? '')
        : extractUsageFromResponseText(raw.responseRaw ?? '');
    let matchedStoredPending: CacheSummaryRecord | null = null;
    const queuedCapture = claimTauriPendingCapture(runtime, payload, entry.timestampMs);
    const capture = createPendingCapture(runtime, payload, queuedCapture?.summary.timestamp ?? entry.timestampMs);
    if (queuedCapture) {
      rebaseCaptureIdentity(capture, queuedCapture.summary.id, queuedCapture.summary.timestamp);
    } else {
      const storedPending = await claimStoredTauriPendingSummary(
        runtime,
        capture.summary,
        entry.timestampMs,
        targetWindow,
        responseUsage,
      );
      if (storedPending) {
        matchedStoredPending = storedPending;
        rebaseCaptureIdentity(capture, storedPending.id, storedPending.timestamp);
        traceCacheInspector(targetWindow, 'tt.log.stored-pending.matched', {
          logId,
          storedId: storedPending.id,
          logRecordId: capture.summary.id,
          ...captureLogDetails(capture.summary),
          ...tauriRuntimeTraceDetails(runtime),
        });
        logDiagnostic(
          targetWindow,
          'info',
          `TauriTavern 原生日志回填已有请求中记录 logId=${logId} recordId=${storedPending.id} model=${capture.summary.model} messages=${capture.summary.messageCount}`,
          undefined,
          true,
        );
      }
    }
    const matchedExisting = !!queuedCapture || runtime.tauriStoredPendingClaimIds.has(capture.summary.id);
    const nativeSnapshot =
      matchedStoredPending?.snapshotAvailable && !matchedStoredPending.rawUsage ? undefined : capture.snapshot;
    traceCacheInspector(targetWindow, matchedExisting ? 'tt.log.pending.matched' : 'tt.log.pending.unmatched-new-record', {
      logId,
      queuedId: queuedCapture?.summary.id ?? null,
      logRecordId: capture.summary.id,
      ...captureLogDetails(capture.summary),
      ...tauriRuntimeTraceDetails(runtime),
    });
    logDiagnostic(targetWindow, 'info', 'TauriTavern 原生日志捕获生成请求', {
      logId,
      source: entry.source ?? null,
      endpoint: entry.endpoint ?? null,
      stream: entry.stream ?? null,
      ...captureLogDetails(capture.summary),
    }, true);

    if (entry.ok === false) {
      await saveCaptureSilently({
        ...capture.summary,
        status: 'failed',
        errorMessage: 'TauriTavern 后端请求失败',
      });
      runtime.tauriLogProcessedIds.add(logId);
      runtime.tauriLogRetryIds.delete(logId);
      traceCacheInspector(targetWindow, 'tt.log.entry.failed-status', { logId, id: capture.summary.id });
      return;
    }

    if (raw.responseRawKind === 'json') {
      await hydrateRecordFromResponseValue(
        capture.summary,
        responseValue,
        raw.responseRaw ?? '',
        nativeSnapshot,
      );
    } else {
      await hydrateRecordFromResponseText(capture.summary, raw.responseRaw ?? '', nativeSnapshot);
    }
    runtime.tauriLogProcessedIds.add(logId);
    runtime.tauriLogRetryIds.delete(logId);
    traceCacheInspector(targetWindow, 'tt.log.entry.completed', {
      logId,
      id: capture.summary.id,
      ...tauriRuntimeTraceDetails(runtime),
    });
  } catch (error) {
    runtime.tauriLogRetryIds.add(logId);
    traceCacheInspector(targetWindow, 'tt.log.entry.raw-read-failed', {
      logId,
      error: formatError(error),
      ...tauriRuntimeTraceDetails(runtime),
    });
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
  if (runtime.tauriPendingCaptures.some(pendingCapture => pendingCapture.summary.id === capture.summary.id)) return;
  if (
    runtime.tauriVisibleResponseFallbackCaptures.some(
      fallbackCapture => fallbackCapture.summary.id === capture.summary.id,
    )
  ) {
    return;
  }
  runtime.tauriPendingCaptures.push(capture);
  traceCacheInspector(safeGlobalMonitorWindow(), 'tt.pending.queue', {
    ...captureLogDetails(capture.summary),
    ...tauriRuntimeTraceDetails(runtime),
  });
}

function queueHostPendingCapture(runtime: CacheInspectorMonitorRuntime, capture: PendingCapture): void {
  pruneHostPendingCaptures(runtime, Date.now());
  if (runtime.hostPendingCaptures.some(pendingCapture => pendingCapture.summary.id === capture.summary.id)) return;
  runtime.hostPendingCaptures.push(capture);
}

function claimHostPendingCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown> | null,
): PendingCapture | null {
  if (!payload) return null;
  pruneHostPendingCaptures(runtime, Date.now());
  const selected = selectMatchingTauriCapture(runtime.hostPendingCaptures, payload, Date.now(), 8_000, true, true);
  if (!selected) return null;
  const [capture] = runtime.hostPendingCaptures.splice(selected.index, 1);
  if (!capture) return null;
  capture.hostCompletionHandled = true;
  return capture;
}

function hasMatchingHostCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown> | null,
): boolean {
  if (!payload) return false;
  pruneHostPendingCaptures(runtime, Date.now());
  return !!selectMatchingTauriCapture(runtime.hostPendingCaptures, payload, Date.now(), 8_000, true, true);
}

function forgetHostPendingCapture(runtime: CacheInspectorMonitorRuntime, id: string): void {
  runtime.hostPendingCaptures = runtime.hostPendingCaptures.filter(capture => capture.summary.id !== id);
}

function pruneHostPendingCaptures(runtime: CacheInspectorMonitorRuntime, now: number): void {
  const cutoff = now - 30_000;
  runtime.hostPendingCaptures = runtime.hostPendingCaptures.filter(capture => capture.summary.timestamp >= cutoff);
}

function findMatchingTauriPendingCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown>,
  completedAt: number,
  maxAgeMs = TAURI_PENDING_CAPTURE_MAX_AGE_MS,
): PendingCapture | null {
  pruneTauriPendingCaptures(runtime, completedAt);
  return selectMatchingTauriCapture(runtime.tauriPendingCaptures, payload, completedAt, maxAgeMs)?.capture ?? null;
}

function claimTauriPendingCapture(
  runtime: CacheInspectorMonitorRuntime,
  payload: Record<string, unknown>,
  completedAt?: number,
): PendingCapture | null {
  const timestamp = typeof completedAt === 'number' && Number.isFinite(completedAt) ? completedAt : Date.now();
  pruneTauriPendingCaptures(runtime, timestamp);
  const selectedPending = selectMatchingTauriCapture(
    runtime.tauriPendingCaptures,
    payload,
    timestamp,
    TAURI_PENDING_CAPTURE_MAX_AGE_MS,
    true,
    true,
  );
  if (selectedPending) {
    const [capture] = runtime.tauriPendingCaptures.splice(selectedPending.index, 1);
    return capture ?? null;
  }

  const selectedFallback = selectMatchingTauriCapture(
    runtime.tauriVisibleResponseFallbackCaptures,
    payload,
    timestamp,
    TAURI_VISIBLE_RESPONSE_FALLBACK_TTL_MS,
    true,
    true,
  );
  if (selectedFallback) {
    const [capture] = runtime.tauriVisibleResponseFallbackCaptures.splice(selectedFallback.index, 1);
    return capture ?? null;
  }

  return null;
}

async function claimStoredTauriPendingSummary(
  runtime: CacheInspectorMonitorRuntime,
  summary: CacheSummaryRecord,
  completedAt?: number,
  targetWindow: MonitorWindow = safeGlobalMonitorWindow(),
  nativeUsage?: Record<string, unknown> | null,
): Promise<CacheSummaryRecord | null> {
  const timestamp = typeof completedAt === 'number' && Number.isFinite(completedAt) ? completedAt : Date.now();
  try {
    const summaries = await listCacheSummaries();
    const pendingRecords = summaries
      .filter(record => isClaimableStoredTauriSummary(record, summary, timestamp, nativeUsage ?? null))
      .filter(record => !runtime.tauriStoredPendingClaimIds.has(record.id))
      .filter(record => record.id !== summary.id)
      .filter(record => record.model === summary.model || record.model === '当前模型' || summary.model === '当前模型')
      .filter(record => isStoredTauriPendingInTimeWindow(record, timestamp));
    const candidates = pendingRecords
      .map(record => ({
        record,
        score: scoreStoredTauriPendingSummary(record, summary, timestamp, nativeUsage ?? null),
      }))
      .filter((match): match is { record: CacheSummaryRecord; score: number } => match.score > 0)
      .sort((left, right) => right.score - left.score || Math.abs(left.record.timestamp - timestamp) - Math.abs(right.record.timestamp - timestamp));

    const selected = candidates[0]?.record ?? null;
    if (selected) {
      runtime.tauriStoredPendingClaimIds.add(selected.id);
    } else {
      logStoredTauriPendingMiss(targetWindow, summary, timestamp, pendingRecords);
    }
    return selected;
  } catch (error) {
    traceCacheInspector(safeGlobalMonitorWindow(), 'tt.log.stored-pending.lookup.failed', {
      id: summary.id,
      error: formatError(error),
    });
    return null;
  }
}

function isClaimableStoredTauriSummary(
  record: CacheSummaryRecord,
  summary: CacheSummaryRecord,
  completedAt: number,
  nativeUsage: Record<string, unknown> | null,
): boolean {
  if (record.status === 'pending') return true;
  if (record.status !== 'completed') return false;
  if (record.rawUsage) return isLikelyStoredTauriCompletedDuplicate(record, summary, completedAt, nativeUsage);
  if (record.hitTokens || record.missTokens || record.totalCacheTokens || record.outputTokens || record.totalTokens) {
    return false;
  }
  return (
    !record.errorMessage ||
    record.errorMessage === NO_CACHE_USAGE_MESSAGE ||
    record.errorMessage === LEGACY_NO_CACHE_USAGE_MESSAGE
  );
}

function isStoredTauriPendingInTimeWindow(record: CacheSummaryRecord, completedAt: number): boolean {
  if (record.timestamp < completedAt - TAURI_PENDING_CAPTURE_MAX_AGE_MS) return false;
  if (record.timestamp > completedAt + 30_000) return false;
  return true;
}

function isLikelyStoredTauriCompletedDuplicate(
  record: CacheSummaryRecord,
  summary: CacheSummaryRecord,
  completedAt: number,
  nativeUsage: Record<string, unknown> | null,
): boolean {
  if (!nativeUsage || !record.rawUsage) return false;
  if (record.model !== summary.model && record.model !== '当前模型' && summary.model !== '当前模型') return false;
  if (Math.abs(record.timestamp - completedAt) > 60_000) return false;
  if (record.messageCount !== summary.messageCount && Math.abs(record.timestamp - completedAt) > 5_000) return false;
  return usageSnapshotsMatch(record, usageToSnapshot(nativeUsage));
}

function logStoredTauriPendingMiss(
  targetWindow: MonitorWindow,
  summary: CacheSummaryRecord,
  completedAt: number,
  pendingRecords: CacheSummaryRecord[],
): void {
  const candidates = pendingRecords
    .map(record => ({
      id: record.id,
      model: record.model,
      messageCount: record.messageCount,
      promptChars: record.promptChars,
      distanceMs: record.timestamp - completedAt,
      score: scoreStoredTauriPendingSummary(record, summary, completedAt),
    }))
    .sort((left, right) => right.score - left.score || Math.abs(left.distanceMs) - Math.abs(right.distanceMs))
    .slice(0, 5);
  const candidateText = candidates.length > 0
    ? candidates.map(candidate =>
      `${candidate.id}:score=${candidate.score},dt=${Math.round(candidate.distanceMs / 1000)}s,msg=${candidate.messageCount},chars=${candidate.promptChars},model=${candidate.model}`,
    ).join(' | ')
    : 'none';
  logDiagnostic(
    targetWindow,
    'info',
    `TauriTavern 原生日志未匹配请求中记录 model=${summary.model} messages=${summary.messageCount} chars=${summary.promptChars} candidates=${candidateText}`,
    undefined,
    true,
  );
}

function scoreStoredTauriPendingSummary(
  record: CacheSummaryRecord,
  summary: CacheSummaryRecord,
  completedAt: number,
  nativeUsage: Record<string, unknown> | null = null,
): number {
  const distanceMs = Math.abs(record.timestamp - completedAt);
  const modelExact = record.model === summary.model;
  if (record.rawUsage) {
    if (!isLikelyStoredTauriCompletedDuplicate(record, summary, completedAt, nativeUsage)) return 0;
    let duplicateScore = modelExact ? 40 : 24;
    if (record.messageCount === summary.messageCount) duplicateScore += 10;
    if (record.promptChars === summary.promptChars) duplicateScore += 10;
    if (distanceMs <= 5_000) duplicateScore += 8;
    else if (distanceMs <= 30_000) duplicateScore += 5;
    else duplicateScore += 2;
    return duplicateScore;
  }

  let score = modelExact ? 12 : 3;
  const messageMatches = record.messageCount === summary.messageCount;
  const promptMatches = record.promptChars === summary.promptChars;
  if (messageMatches) score += 10;
  if (promptMatches) score += 10;
  if (!messageMatches && !promptMatches) {
    if (record.timestamp > completedAt + 3_000) return 0;
    if (distanceMs > TAURI_STORED_PENDING_LOOSE_MATCH_MAX_AGE_MS) return 0;
    score += 2;
  }

  const distanceSeconds = distanceMs / 1000;
  if (distanceSeconds <= 5) score += 8;
  else if (distanceSeconds <= 30) score += 5;
  else if (distanceSeconds <= 120) score += 3;
  else if (distanceMs <= TAURI_STORED_PENDING_LOOSE_MATCH_MAX_AGE_MS) score += 1;
  return score;
}

function usageSnapshotsMatch(left: CacheUsageSnapshot, right: CacheUsageSnapshot): boolean {
  return (
    left.hitTokens === right.hitTokens &&
    left.missTokens === right.missTokens &&
    left.totalCacheTokens === right.totalCacheTokens &&
    left.outputTokens === right.outputTokens &&
    left.totalTokens === right.totalTokens
  );
}

function selectMatchingTauriCapture(
  captures: PendingCapture[],
  payload: Record<string, unknown>,
  completedAt: number,
  maxAgeMs: number,
  allowSingleLooseFallback = false,
  allowPromptMismatchFallback = false,
): { capture: PendingCapture; index: number } | null {
  const model = typeof payload.model === 'string' && payload.model.trim() ? payload.model : '';
  const payloadMessages = payloadToMessageSnapshots(payload);
  const eligibleCaptures = captures
    .map((capture, index) => ({ capture, index }))
    .filter(({ capture }) => isTauriCaptureInTimeWindow(capture, completedAt, maxAgeMs));
  const scored = eligibleCaptures
    .map(({ capture, index }) =>
      scoreTauriCaptureMatch(capture, index, model, payloadMessages, completedAt, allowPromptMismatchFallback),
    )
    .filter((match): match is { capture: PendingCapture; index: number; score: number; distance: number } => !!match)
    .sort((left, right) => right.score - left.score || left.distance - right.distance);
  if (scored[0]) return scored[0];
  return allowSingleLooseFallback && eligibleCaptures.length === 1 ? eligibleCaptures[0] : null;
}

function isTauriCaptureInTimeWindow(capture: PendingCapture, completedAt: number, maxAgeMs: number): boolean {
  if (capture.summary.timestamp < completedAt - maxAgeMs) return false;
  if (capture.summary.timestamp > completedAt + 30_000) return false;
  return true;
}

function scoreTauriCaptureMatch(
  capture: PendingCapture,
  index: number,
  model: string,
  payloadMessages: PromptMessageSnapshot[],
  completedAt: number,
  allowPromptMismatchFallback = false,
): { capture: PendingCapture; index: number; score: number; distance: number } | null {
  if (model && capture.summary.model !== '当前模型' && capture.summary.model !== model) return null;

  let score = model && capture.summary.model === model ? 4 : 0;
  const captureMessages = capture.snapshot?.messages ?? [];
  if (payloadMessages.length > 0 && captureMessages.length > 0) {
    if (promptSnapshotsMatch(captureMessages, payloadMessages)) {
      score += 8;
    } else if (!allowPromptMismatchFallback) {
      return null;
    }
  } else if (payloadMessages.length === 0 || captureMessages.length === 0) {
    score += 1;
  }

  return {
    capture,
    index,
    score,
    distance: Math.abs(completedAt - capture.summary.timestamp),
  };
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
  const cutoff = now - TAURI_PENDING_CAPTURE_MAX_AGE_MS;
  const fallbackCutoff = now - TAURI_VISIBLE_RESPONSE_FALLBACK_TTL_MS;
  runtime.tauriPendingCaptures = runtime.tauriPendingCaptures.filter(capture => capture.summary.timestamp >= cutoff);
  runtime.tauriVisibleResponseFallbackCaptures = runtime.tauriVisibleResponseFallbackCaptures.filter(
    capture => (capture.fallbackAt ?? capture.summary.timestamp) >= fallbackCutoff,
  );
}

function rebaseCaptureIdentity(capture: PendingCapture, id: string, timestamp: number): void {
  capture.summary.id = id;
  capture.summary.timestamp = timestamp;
  if (capture.snapshot) {
    capture.snapshot.id = id;
    capture.snapshot.timestamp = timestamp;
  }
}

async function getTauriLogRawWithRetry(
  llmApiLogs: TauriLlmApiLogsApi,
  id: number,
  targetWindow: MonitorWindow | null,
): Promise<TauriLlmApiLogRaw> {
  let lastError: unknown = null;
  const retryDelays = [0, 80, 180, 360, 720, 1200];
  for (const [attemptIndex, delayMs] of retryDelays.entries()) {
    if (delayMs > 0) await delay(delayMs);
    try {
      const raw = await llmApiLogs.getRaw?.(id);
      if (raw && typeof raw.requestRaw === 'string') {
        traceCacheInspector(targetWindow, 'tt.log.raw.read.ok', {
          logId: id,
          attempt: attemptIndex + 1,
          delayMs,
          responseRawKind: raw.responseRawKind ?? null,
          requestRawLength: raw.requestRaw.length,
          responseRawLength: typeof raw.responseRaw === 'string' ? raw.responseRaw.length : 0,
        });
        return raw;
      }
      traceCacheInspector(targetWindow, 'tt.log.raw.read.empty', {
        logId: id,
        attempt: attemptIndex + 1,
        delayMs,
        hasRaw: !!raw,
        responseRawKind: raw?.responseRawKind ?? null,
        responseRawLength: typeof raw?.responseRaw === 'string' ? raw.responseRaw.length : 0,
      });
    } catch (error) {
      lastError = error;
      traceCacheInspector(targetWindow, 'tt.log.raw.read.retry', {
        logId: id,
        attempt: attemptIndex + 1,
        delayMs,
        error: formatError(error),
      });
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

function markTauriNativeLogHost(runtime: CacheInspectorMonitorRuntime, targetWindow: MonitorWindow): boolean {
  if (runtime.tauriHostDetected) return true;
  if (!isTauriNativeLogHostWindow(targetWindow)) return false;
  runtime.tauriHostDetected = true;
  traceCacheInspector(targetWindow, 'tt.native-log-host.detected', {
    href: safeWindowHref(targetWindow),
    ...tauriRuntimeTraceDetails(runtime),
  });
  return true;
}

function isTauriNativeLogHostWindow(targetWindow: MonitorWindow): boolean {
  try {
    const host = targetWindow.__TAURITAVERN__;
    if (!isRecord(host)) return false;
    if ('ready' in host) return true;
    if (isRecord(host.api?.dev)) return true;
    if (isRecord(host.invoke?.broker)) return true;
    if (targetWindow.__TAURITAVERN_MAIN_READY__) return true;
  } catch {
    // 忽略跨窗口访问异常。
  }
  return false;
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

async function hydrateRecordFromResponse(
  record: CacheSummaryRecord,
  response: Response,
  snapshot?: PromptSnapshotRecord | null,
): Promise<void> {
  try {
    const text = await response.clone().text();
    await hydrateRecordFromResponseText(record, text, snapshot);
  } catch (error) {
    await saveCaptureSilently({
      ...record,
      status: 'completed',
      snapshotAvailable: !!snapshot,
      errorMessage: `读取缓存数据失败：${formatError(error)}`,
    }, snapshot ?? null);
  }
}

async function hydrateRecordFromResponseText(
  record: CacheSummaryRecord,
  text: string,
  snapshot?: PromptSnapshotRecord | null,
): Promise<void> {
  const usage = extractUsageFromResponseText(text);
  await hydrateRecordFromUsage(record, usage, snapshot);
}

async function hydrateRecordFromResponseValue(
  record: CacheSummaryRecord,
  value: unknown,
  fallbackText?: string | null,
  snapshot?: PromptSnapshotRecord | null,
): Promise<void> {
  const usage = extractUsageFromResponseValue(value) ?? (fallbackText ? extractUsageFromResponseText(fallbackText) : null);
  await hydrateRecordFromUsage(record, usage, snapshot);
}

async function hydrateRecordFromUsage(
  record: CacheSummaryRecord,
  usage: Record<string, unknown> | null,
  snapshot?: PromptSnapshotRecord | null,
): Promise<void> {
  const usageSnapshot = usageToSnapshot(usage);
  const pricing = estimateCacheCost(record.model, usageSnapshot);
  const completedRecord = {
    ...record,
    ...usageSnapshot,
    ...pricing,
    status: 'completed',
    snapshotAvailable: snapshot === undefined ? record.snapshotAvailable : !!snapshot,
    errorMessage: usage ? null : NO_CACHE_USAGE_MESSAGE,
  } satisfies CacheSummaryRecord;
  traceCacheInspector(safeGlobalMonitorWindow(), 'record.hydrate.usage', {
    id: completedRecord.id,
    model: completedRecord.model,
    hasUsage: !!usage,
    rawUsageKeys: usage ? Object.keys(usage).slice(0, 20) : [],
    hitTokens: completedRecord.hitTokens,
    missTokens: completedRecord.missTokens,
    outputTokens: completedRecord.outputTokens,
    totalTokens: completedRecord.totalTokens,
    errorMessage: completedRecord.errorMessage,
  });
  await saveCaptureSilently(completedRecord, snapshot ?? null);
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
  if (Array.isArray(payload.ordered_prompts)) {
    return payload.ordered_prompts.map(messageToSnapshot).filter(snapshot => snapshot.text.length > 0);
  }

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

function tavernHelperGenerateRawArgsToPayload(args: unknown[]): Record<string, unknown> | null {
  const options = isRecord(args[0]) ? args[0] : {};
  const messages = [
    ...promptLikeToMessages(options.prompt),
    ...promptLikeToMessages(options.ordered_prompts),
    ...promptLikeToMessages(options.user_input),
  ];
  const customApi = getRecordProperty(options, 'custom_api');
  const model = firstString(customApi?.model, options.model);
  return {
    messages,
    ...(model ? { model } : {}),
    stream: Boolean(options.should_stream),
  };
}

function connectionManagerSendRequestArgsToPayload(args: unknown[]): Record<string, unknown> | null {
  const prompt = args[1];
  const overridePayload = isRecord(args[4]) ? args[4] : {};
  const model = firstString(overridePayload.model);
  return {
    messages: promptLikeToMessages(prompt),
    ...(model ? { model } : {}),
    max_tokens: typeof args[2] === 'number' ? args[2] : undefined,
  };
}

function serviceProcessRequestArgsToPayload(args: unknown[]): Record<string, unknown> | null {
  const requestData = isRecord(args[0]) ? args[0] : {};
  if (Array.isArray(requestData.messages)) return requestData;
  if (Array.isArray(requestData.prompt) || typeof requestData.prompt === 'string') {
    return {
      ...requestData,
      messages: promptLikeToMessages(requestData.prompt),
    };
  }
  return requestData;
}

function promptLikeToMessages(value: unknown): Array<{ role: string; content: unknown }> {
  if (typeof value === 'string') return value ? [{ role: 'user', content: value }] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (typeof item === 'string') return null;
      if (!isRecord(item)) return null;
      const content = item.content ?? item.text ?? item.prompt;
      const text = messageContentToText(content);
      if (!text) return null;
      const role = typeof item.role === 'string' ? item.role : 'user';
      return { role, content: text };
    })
    .filter((message): message is { role: string; content: unknown } => !!message);
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
    const rawLine = line.trim();
    const data = rawLine.replace(/^data:\s*/u, '');
    if (!data || data === '[DONE]') continue;
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
    traceCacheInspector(safeGlobalMonitorWindow(), 'record.save.ok', {
      id: summary.id,
      status: summary.status,
      model: summary.model,
      hitTokens: summary.hitTokens,
      missTokens: summary.missTokens,
      totalTokens: summary.totalTokens,
      snapshotSaved: !!snapshot,
      errorMessage: summary.errorMessage,
    });
    dispatchRecordsChanged(summary.id, summary);
  } catch (error) {
    traceCacheInspector(safeGlobalMonitorWindow(), 'record.save.failed', {
      id: summary.id,
      status: summary.status,
      error: formatError(error),
    });
    console.warn('[缓存命中对比] 保存缓存记录失败', error);
  }
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
    collectSameOriginEventChildWindows(targetWindow, targets);
  }
  return targets;
}

function collectSameOriginEventChildWindows(rootWindow: MonitorWindow, targets: MonitorWindow[]): void {
  let frameElements: Array<{ contentWindow?: Window | null }> = [];
  try {
    frameElements = Array.from(rootWindow.document?.querySelectorAll?.('iframe,frame') ?? []);
  } catch {
    return;
  }

  for (const frameElement of frameElements) {
    let frameWindow: MonitorWindow | null = null;
    try {
      frameWindow = frameElement.contentWindow as MonitorWindow | null;
    } catch {
      frameWindow = null;
    }
    if (!frameWindow || targets.includes(frameWindow) || !canAccessWindow(frameWindow)) continue;
    targets.push(frameWindow);
    collectSameOriginEventChildWindows(frameWindow, targets);
  }
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

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isRecord(value) && typeof value[Symbol.asyncIterator] === 'function';
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
    collectSameOriginChildWindows(targetWindow, targets);
  }
  return targets;
}

function collectSameOriginChildWindows(rootWindow: MonitorWindow, targets: MonitorWindow[]): void {
  let frameElements: Array<{ contentWindow?: Window | null }> = [];
  try {
    frameElements = Array.from(rootWindow.document?.querySelectorAll?.('iframe,frame') ?? []);
  } catch {
    return;
  }

  for (const frameElement of frameElements) {
    let frameWindow: MonitorWindow | null = null;
    try {
      frameWindow = frameElement.contentWindow as MonitorWindow | null;
    } catch {
      frameWindow = null;
    }
    if (!frameWindow || targets.includes(frameWindow)) continue;
    if (!canAccessWindow(frameWindow) || !hasCaptureSurface(frameWindow)) continue;
    targets.push(frameWindow);
    collectSameOriginChildWindows(frameWindow, targets);
  }
}

function getRecordProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return isRecord(property) ? property : null;
}

function safeGetTavernHelper(targetWindow: MonitorWindow): TavernHelperApi | null {
  try {
    const helper = targetWindow.TavernHelper;
    return isRecord(helper) ? (helper as TavernHelperApi) : null;
  } catch {
    return null;
  }
}

function safeGetSillyTavernContext(targetWindow: MonitorWindow): Record<string, unknown> | null {
  try {
    const tavern = targetWindow.SillyTavern;
    if (!tavern || typeof tavern.getContext !== 'function') return null;
    const context = tavern.getContext();
    return isRecord(context) ? context : null;
  } catch {
    return null;
  }
}

function safeSetHostFunction(owner: HostFunctionOwner, key: string, nextFunction: HostCaptureFunction): boolean {
  try {
    owner[key] = nextFunction;
    return true;
  } catch {
    return false;
  }
}

function restoreHostFunctionPatch(functionPatch: HostFunctionPatch): void {
  if (functionPatch.owner[functionPatch.key] !== functionPatch.patchedFunction) return;
  safeSetHostFunction(functionPatch.owner, functionPatch.key, functionPatch.originalFunction);
}

function hasCaptureSurface(targetWindow: MonitorWindow): boolean {
  return (
    !!safeGetFetch(targetWindow) ||
    getAjaxOwners(targetWindow).some(owner => !!safeGetAjax(owner)) ||
    !!safeGetXMLHttpRequest(targetWindow) ||
    !!safeGetTavernHelper(targetWindow) ||
    !!safeGetSillyTavernContext(targetWindow) ||
    isTauriNativeLogHostWindow(targetWindow)
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
    return delegateFetch(...args);
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

function createResponseTextPromise(response: Response): Promise<string> {
  try {
    const textPromise = response.clone().text();
    void textPromise.catch(() => undefined);
    return textPromise;
  } catch (error) {
    const textPromise = Promise.reject(error);
    void textPromise.catch(() => undefined);
    return textPromise;
  }
}

function scheduleTauriVisibleResponseFallback(
  runtime: CacheInspectorMonitorRuntime,
  capture: PendingCapture,
  responseTextPromise: Promise<string>,
): void {
  traceCacheInspector(safeGlobalMonitorWindow(), 'tt.visible-response-fallback.schedule', {
    ...captureLogDetails(capture.summary),
    delayMs: TAURI_VISIBLE_RESPONSE_FALLBACK_DELAY_MS,
    ...tauriRuntimeTraceDetails(runtime),
  });
  setTimeout(() => {
    if (runtime.destroyed) return;
    const fallbackCapture = moveTauriPendingCaptureToVisibleFallback(runtime, capture.summary.id);
    if (!fallbackCapture) {
      traceCacheInspector(safeGlobalMonitorWindow(), 'tt.visible-response-fallback.skip-not-pending', {
        id: capture.summary.id,
        ...tauriRuntimeTraceDetails(runtime),
      });
      return;
    }
    traceCacheInspector(safeGlobalMonitorWindow(), 'tt.visible-response-fallback.fire', {
      ...captureLogDetails(fallbackCapture.summary),
      ...tauriRuntimeTraceDetails(runtime),
    });

    void responseTextPromise.then(
      text => hydrateRecordFromResponseText(fallbackCapture.summary, text, null),
      error =>
        saveCaptureSilently({
          ...fallbackCapture.summary,
          status: 'completed',
          snapshotAvailable: false,
          errorMessage: `读取缓存数据失败：${formatError(error)}`,
        }),
    );
  }, TAURI_VISIBLE_RESPONSE_FALLBACK_DELAY_MS);
}

function moveTauriPendingCaptureToVisibleFallback(
  runtime: CacheInspectorMonitorRuntime,
  id: string,
): PendingCapture | null {
  const index = runtime.tauriPendingCaptures.findIndex(capture => capture.summary.id === id);
  if (index < 0) return null;
  const [capture] = runtime.tauriPendingCaptures.splice(index, 1);
  if (!capture) return null;
  capture.fallbackAt = Date.now();
  pruneTauriPendingCaptures(runtime, capture.fallbackAt);
  runtime.tauriVisibleResponseFallbackCaptures.push(capture);
  return capture;
}

function attachAjaxCompletionHandlers(
  record: CacheSummaryRecord,
  result: unknown,
  snapshot?: PromptSnapshotRecord | null,
): void {
  if (!isRecord(result)) return;

  if (typeof result.done === 'function') {
    result.done((data: unknown, _textStatus: unknown, jqXHR: unknown) => {
      void hydrateRecordFromResponseValue(record, data, ajaxResponseText(jqXHR), snapshot);
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
      value => hydrateRecordFromResponseValue(record, value, null, snapshot),
      error =>
        saveCaptureSilently({
          ...record,
          status: 'failed',
          errorMessage: formatError(error),
        }),
    );
  }
}

function attachAjaxTauriCompletionHandlers(
  runtime: CacheInspectorMonitorRuntime,
  capture: PendingCapture,
  result: unknown,
  captureVisibleResponseFallback = true,
): void {
  if (!isRecord(result)) return;

  const saveFailed = (message: string): void => {
    forgetTauriPendingCapture(runtime, capture.summary.id);
    void saveCaptureSilently({
      ...capture.summary,
      status: 'failed',
      errorMessage: message,
    });
  };

  const scheduleFallback = (data: unknown, fallbackText?: string | null): void => {
    const textPromise =
      captureVisibleResponseFallback
        ? typeof fallbackText === 'string' ? Promise.resolve(fallbackText) : Promise.resolve(safeStringify(data) ?? '')
        : Promise.resolve('');
    scheduleTauriVisibleResponseFallback(runtime, capture, textPromise);
  };

  if (typeof result.fail === 'function') {
    result.fail((jqXHR: unknown, _textStatus: unknown, errorThrown: unknown) => {
      saveFailed(formatAjaxError(jqXHR, errorThrown));
    });
  }

  if (typeof result.done === 'function') {
    result.done((data: unknown, _textStatus: unknown, jqXHR: unknown) => {
      scheduleFallback(data, ajaxResponseText(jqXHR));
    });
    return;
  }

  if (typeof result.then === 'function') {
    void Promise.resolve(result).then(value => scheduleFallback(value), error => saveFailed(formatError(error)));
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
      hostDetected: runtime.tauriHostDetected,
      apis: runtime.tauriLogApis.size,
      subscriptions: runtime.tauriLogUnsubscribers.length,
      processedIds: runtime.tauriLogProcessedIds.size,
      processingIds: runtime.tauriLogProcessingIds.size,
      retryIds: runtime.tauriLogRetryIds.size,
      indexPollInFlight: runtime.tauriLogIndexPollInFlight.size,
      pendingCaptures: runtime.tauriPendingCaptures.length,
      fallbackCaptures: runtime.tauriVisibleResponseFallbackCaptures.length,
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

function traceCacheInspector(
  targetWindow: MonitorWindow | null,
  stage: string,
  details?: Record<string, unknown>,
): void {
  const entry: CacheInspectorTraceEntry = {
    at: new Date().toISOString(),
    ms: Date.now(),
    stage,
  };
  const sanitizedDetails = sanitizeTraceDetails(details);
  if (sanitizedDetails) entry.details = sanitizedDetails;

  const globalWindow = safeGlobalMonitorWindow();
  pushTraceEntry(globalWindow, entry);
  if (targetWindow && targetWindow !== globalWindow) pushTraceEntry(targetWindow, entry);

  const consoleLike = globalThis.console;
  const method = consoleLike?.log;
  if (typeof method !== 'function') return;
  method.call(consoleLike, `[缓存命中对比][trace] ${stage}`, entry.details ?? {});
}

function pushTraceEntry(targetWindow: MonitorWindow | null, entry: CacheInspectorTraceEntry): void {
  if (!targetWindow) return;
  try {
    const trace = targetWindow.__wbmCacheInspectorTrace ?? [];
    trace.push(entry);
    if (trace.length > CACHE_INSPECTOR_TRACE_LIMIT) trace.splice(0, trace.length - CACHE_INSPECTOR_TRACE_LIMIT);
    targetWindow.__wbmCacheInspectorTrace = trace;
    targetWindow.__wbmCacheInspectorTraceDump = () => trace.slice();
  } catch {
    // 诊断缓冲区只用于复现问题，写入失败不影响捕获。
  }
}

function sanitizeTraceDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined;
  try {
    return JSON.parse(JSON.stringify(details)) as Record<string, unknown>;
  } catch {
    return { note: 'trace details could not be serialized' };
  }
}

function tauriRuntimeTraceDetails(runtime: CacheInspectorMonitorRuntime): Record<string, unknown> {
  return {
    tauriNativeLogActive: runtime.tauriNativeLogActive,
    tauriHostDetected: runtime.tauriHostDetected,
    tauriLogApis: runtime.tauriLogApis.size,
    tauriLogSubscriptions: runtime.tauriLogUnsubscribers.length,
    tauriProcessedIds: runtime.tauriLogProcessedIds.size,
    tauriProcessingIds: runtime.tauriLogProcessingIds.size,
    tauriRetryIds: runtime.tauriLogRetryIds.size,
    tauriStoredPendingClaimIds: runtime.tauriStoredPendingClaimIds.size,
    tauriIndexPollInFlight: runtime.tauriLogIndexPollInFlight.size,
    tauriPendingIds: runtime.tauriPendingCaptures.map(capture => capture.summary.id).slice(-10),
    tauriFallbackIds: runtime.tauriVisibleResponseFallbackCaptures.map(capture => capture.summary.id).slice(-10),
  };
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

function shouldPatchHostFunctions(targetWindow: MonitorWindow): boolean {
  if (isHostFunctionCaptureEnabled(targetWindow)) return true;
  const globalWindow = safeGlobalMonitorWindow();
  return !!globalWindow && globalWindow !== targetWindow && isHostFunctionCaptureEnabled(globalWindow);
}

function isHostFunctionCaptureEnabled(targetWindow: MonitorWindow): boolean {
  try {
    if (targetWindow.__WBM_CACHE_INSPECTOR_HOST_FUNCTION_CAPTURE__) return true;
  } catch {
    return false;
  }

  try {
    const value = targetWindow.localStorage?.getItem(HOST_FUNCTION_CAPTURE_STORAGE_KEY);
    return isEnabledStorageValue(value);
  } catch {
    return false;
  }
}

function isEnabledStorageValue(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'enabled';
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
