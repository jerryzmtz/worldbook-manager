export const EXCHANGE_RATE_UPDATED_EVENT = 'worldbook-manager:cache-exchange-rate-updated';

export const FALLBACK_USD_TO_CNY_RATE = 6.8032;
const RATE_CACHE_KEY = 'worldbookCacheInspectorUsdToCnyRate';
const RATE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RATE_FETCH_TIMEOUT_MS = 5000;

type ExchangeRateSource = 'cache' | 'fallback' | 'frankfurter' | 'exchange-rate-api';

type ExchangeRateSnapshot = {
  rate: number;
  source: ExchangeRateSource;
  updatedAt: number;
  isFallback: boolean;
};

type StoredExchangeRateSnapshot = {
  rate: number;
  source: ExchangeRateSource;
  updatedAt: number;
};

let currentRate: ExchangeRateSnapshot = loadCachedRate() ?? {
  rate: FALLBACK_USD_TO_CNY_RATE,
  source: 'fallback',
  updatedAt: 0,
  isFallback: true,
};
let refreshPromise: Promise<ExchangeRateSnapshot> | null = null;

export function getUsdToCnyRate(): number {
  return currentRate.rate;
}

export function getUsdToCnyRateSnapshot(): ExchangeRateSnapshot {
  return currentRate;
}

export function refreshUsdToCnyRate(force = false): Promise<ExchangeRateSnapshot> {
  if (!force && !currentRate.isFallback && Date.now() - currentRate.updatedAt < RATE_CACHE_MAX_AGE_MS) {
    return Promise.resolve(currentRate);
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = fetchUsdToCnyRate()
    .then(snapshot => {
      currentRate = snapshot;
      saveCachedRate(snapshot);
      dispatchExchangeRateUpdated();
      return snapshot;
    })
    .catch(error => {
      console.warn('[缓存命中对比] 自动更新 USD/CNY 汇率失败，继续使用缓存或 fallback', error);
      return currentRate;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function fetchUsdToCnyRate(): Promise<ExchangeRateSnapshot> {
  const providers: Array<() => Promise<ExchangeRateSnapshot>> = [fetchFromFrankfurter, fetchFromExchangeRateApi];
  let lastError: unknown = null;

  for (const fetchProvider of providers) {
    try {
      return await fetchProvider();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('没有可用的汇率接口');
}

async function fetchFromFrankfurter(): Promise<ExchangeRateSnapshot> {
  const data = await fetchJsonWithTimeout('https://api.frankfurter.dev/v2/rate/USD/CNY');
  const rate = isRecord(data) ? finiteNumber(data.rate) : null;
  return createOnlineSnapshot(rate, 'frankfurter');
}

async function fetchFromExchangeRateApi(): Promise<ExchangeRateSnapshot> {
  const data = await fetchJsonWithTimeout('https://open.er-api.com/v6/latest/USD');
  const rates = isRecord(data) && isRecord(data.rates) ? data.rates : null;
  const rate = rates ? finiteNumber(rates.CNY) : null;
  return createOnlineSnapshot(rate, 'exchange-rate-api');
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const fetchImpl = safeFetch();
  if (!fetchImpl) throw new Error('当前环境没有可用 fetch，无法自动更新汇率');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function createOnlineSnapshot(rate: number | null, source: Exclude<ExchangeRateSource, 'cache' | 'fallback'>): ExchangeRateSnapshot {
  if (!isValidRate(rate)) throw new Error(`${source} 没有返回有效 USD/CNY 汇率`);
  return {
    rate,
    source,
    updatedAt: Date.now(),
    isFallback: false,
  };
}

function loadCachedRate(): ExchangeRateSnapshot | null {
  const storage = safeLocalStorage();
  if (!storage) return null;

  try {
    const stored = JSON.parse(storage.getItem(RATE_CACHE_KEY) || 'null') as StoredExchangeRateSnapshot | null;
    if (!stored || !isValidRate(stored.rate) || !Number.isFinite(stored.updatedAt)) return null;
    return {
      rate: stored.rate,
      source: 'cache',
      updatedAt: stored.updatedAt,
      isFallback: false,
    };
  } catch {
    return null;
  }
}

function saveCachedRate(snapshot: ExchangeRateSnapshot): void {
  const storage = safeLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(
      RATE_CACHE_KEY,
      JSON.stringify({
        rate: snapshot.rate,
        source: snapshot.source,
        updatedAt: snapshot.updatedAt,
      } satisfies StoredExchangeRateSnapshot),
    );
  } catch {
    // localStorage 不可用时不影响计价，下一次仍会用内存或 fallback。
  }
}

function dispatchExchangeRateUpdated(): void {
  const targetWindow = safeWindow();
  if (!targetWindow) return;

  try {
    targetWindow.dispatchEvent(new CustomEvent(EXCHANGE_RATE_UPDATED_EVENT, { detail: currentRate }));
  } catch {
    // 非浏览器测试环境下可忽略。
  }
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isValidRate(value: number | null): value is number {
  return typeof value === 'number' && value > 0 && value < 20;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeFetch(): typeof fetch | null {
  try {
    return typeof fetch === 'function' ? fetch.bind(globalThis) : null;
  } catch {
    return null;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'object' && localStorage !== null ? localStorage : null;
  } catch {
    return null;
  }
}

function safeWindow(): Window | null {
  try {
    return typeof window === 'object' && window !== null ? window : null;
  } catch {
    return null;
  }
}
