import { estimateCacheCost } from './pricing';
import type { CacheSummaryRecord } from './types';

const DEFAULT_DAY_COUNT = 31;

export type CacheUsageChartBucket = {
  key: string;
  timestamp: number;
  label: string;
  requestCount: number;
  hitTokens: number;
  missTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCny: number;
  savedCny: number;
};

export type CacheUsageModelSummary = {
  model: string;
  requestCount: number;
  hitTokens: number;
  missTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCny: number;
  savedCny: number;
};

export type CacheUsageChartData = {
  dayCount: number;
  startLabel: string;
  endLabel: string;
  requestCount: number;
  hitTokens: number;
  missTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCny: number;
  savedCny: number;
  pricedCount: number;
  unmatchedPriceCount: number;
  buckets: CacheUsageChartBucket[];
  modelSummaries: CacheUsageModelSummary[];
};

export function buildCacheUsageChartData(
  records: CacheSummaryRecord[],
  now = Date.now(),
  dayCount = DEFAULT_DAY_COUNT,
): CacheUsageChartData {
  const normalizedDayCount = Math.max(1, Math.floor(dayCount));
  const todayStart = startOfLocalDay(now);
  const startTimestamp = addDays(todayStart, -(normalizedDayCount - 1));
  const endTimestamp = addDays(todayStart, 1);
  const buckets = createBuckets(startTimestamp, normalizedDayCount);
  const bucketMap = new Map(buckets.map(bucket => [bucket.key, bucket]));
  const modelMap = new Map<string, CacheUsageModelSummary>();
  let pricedCount = 0;
  let unmatchedPriceCount = 0;

  for (const record of records) {
    if (record.timestamp < startTimestamp || record.timestamp >= endTimestamp) continue;

    const bucket = bucketMap.get(dateKey(record.timestamp));
    if (!bucket) continue;

    const cost = estimateCacheCost(record.model, record).costSnapshot;
    const tokenTotal = tokenTotalForRecord(record);

    bucket.requestCount += 1;
    bucket.hitTokens += record.hitTokens;
    bucket.missTokens += record.missTokens;
    bucket.outputTokens += record.outputTokens;
    bucket.totalTokens += tokenTotal;
    if (cost) {
      bucket.totalCny += cost.totalCny;
      bucket.savedCny += cost.savedCny;
      pricedCount += 1;
    } else if (shouldCountAsUnmatchedPrice(record)) {
      unmatchedPriceCount += 1;
    }

    const summary = modelMap.get(record.model) ?? createModelSummary(record.model);
    summary.requestCount += 1;
    summary.hitTokens += record.hitTokens;
    summary.missTokens += record.missTokens;
    summary.outputTokens += record.outputTokens;
    summary.totalTokens += tokenTotal;
    if (cost) {
      summary.totalCny += cost.totalCny;
      summary.savedCny += cost.savedCny;
    }
    modelMap.set(record.model, summary);
  }

  return {
    dayCount: normalizedDayCount,
    startLabel: buckets[0]?.label ?? '',
    endLabel: buckets[buckets.length - 1]?.label ?? '',
    requestCount: buckets.reduce((sum, bucket) => sum + bucket.requestCount, 0),
    hitTokens: buckets.reduce((sum, bucket) => sum + bucket.hitTokens, 0),
    missTokens: buckets.reduce((sum, bucket) => sum + bucket.missTokens, 0),
    outputTokens: buckets.reduce((sum, bucket) => sum + bucket.outputTokens, 0),
    totalTokens: buckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0),
    totalCny: buckets.reduce((sum, bucket) => sum + bucket.totalCny, 0),
    savedCny: buckets.reduce((sum, bucket) => sum + bucket.savedCny, 0),
    pricedCount,
    unmatchedPriceCount,
    buckets,
    modelSummaries: Array.from(modelMap.values()).sort((left, right) => right.totalCny - left.totalCny),
  };
}

function createBuckets(startTimestamp: number, dayCount: number): CacheUsageChartBucket[] {
  return Array.from({ length: dayCount }, (_, index) => {
    const timestamp = addDays(startTimestamp, index);
    return {
      key: dateKey(timestamp),
      timestamp,
      label: formatDayLabel(timestamp),
      requestCount: 0,
      hitTokens: 0,
      missTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCny: 0,
      savedCny: 0,
    };
  });
}

function createModelSummary(model: string): CacheUsageModelSummary {
  return {
    model,
    requestCount: 0,
    hitTokens: 0,
    missTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCny: 0,
    savedCny: 0,
  };
}

function tokenTotalForRecord(record: CacheSummaryRecord): number {
  return record.totalTokens || record.hitTokens + record.missTokens + record.outputTokens;
}

function shouldCountAsUnmatchedPrice(record: CacheSummaryRecord): boolean {
  if (record.status !== 'completed') return false;
  return record.totalCacheTokens + record.outputTokens > 0;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
