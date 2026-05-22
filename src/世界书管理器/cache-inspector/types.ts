export type CacheRecordStatus = 'pending' | 'completed' | 'failed';

export type PromptMessageSnapshot = {
  role: string;
  text: string;
  length: number;
  hash: string;
};

export type CacheUsageSnapshot = {
  hitTokens: number;
  missTokens: number;
  totalCacheTokens: number;
  hitRate: number | null;
  outputTokens: number;
  totalTokens: number;
  rawUsage: Record<string, unknown> | null;
};

export type PricingSnapshot = {
  id: string;
  provider: 'deepseek' | 'gemini' | 'openai';
  label: string;
  sourceUrl: string;
  sourceDate: string;
  currency: 'CNY';
  usdToCnyRate: number;
  inputHitUsdPerMillion: number;
  inputMissUsdPerMillion: number;
  outputUsdPerMillion: number;
  note: string | null;
};

export type CacheCostSnapshot = {
  currency: 'CNY';
  inputHitCny: number;
  inputMissCny: number;
  outputCny: number;
  totalCny: number;
  savedCny: number;
};

export type CacheSummaryRecord = CacheUsageSnapshot & {
  id: string;
  timestamp: number;
  status: CacheRecordStatus;
  model: string;
  messageCount: number;
  promptChars: number;
  snapshotAvailable: boolean;
  pricingSnapshot: PricingSnapshot | null;
  costSnapshot: CacheCostSnapshot | null;
  errorMessage: string | null;
};

export type PromptSnapshotRecord = {
  id: string;
  timestamp: number;
  messages: PromptMessageSnapshot[];
};

export type CacheRecord = CacheSummaryRecord & {
  messages: PromptMessageSnapshot[];
};

export type PromptTextRange = {
  start: number;
  end: number;
  length: number;
};

export type PromptFullTextSegment = {
  id: string;
  text: string;
  kind: 'context' | 'changed';
  marker: boolean;
};

export type PromptDiffKind = 'same' | 'message_added' | 'message_removed' | 'role_changed' | 'content_changed';

export type PromptDiffContext = {
  prefix: string;
  beforeChanged: string;
  afterChanged: string;
  suffix: string;
  prefixLength: number;
  suffixLength: number;
  beforeChangedLength: number;
  afterChangedLength: number;
  beforeRange: PromptTextRange;
  afterRange: PromptTextRange;
  hasMorePrefix: boolean;
  hasMoreSuffix: boolean;
};

export type PromptDiffResult = {
  kind: PromptDiffKind;
  summary: string;
  index: number | null;
  beforeIndex: number | null;
  afterIndex: number | null;
  beforeRole: string | null;
  afterRole: string | null;
  beforeLength: number;
  afterLength: number;
  context: PromptDiffContext | null;
};

export type CacheRecordsChangedEvent = CustomEvent<{ recordId?: string; summary?: CacheSummaryRecord }>;

export type CacheRateFilter = 'all' | 'has_usage' | 'gt_zero' | 'gte_30' | 'gte_60' | 'custom';

export type CacheDiffabilityFilter = 'all' | 'diffable' | 'stats_only';

export type CacheRecordFilterState = {
  model: string;
  cacheRate: CacheRateFilter;
  customMinRate: number;
  diffability: CacheDiffabilityFilter;
};

export type CacheVisibleStats = {
  count: number;
  latest: CacheSummaryRecord | null;
  hitTokens: number;
  missTokens: number;
  outputTokens: number;
  weightedHitRate: number | null;
  totalCny: number;
  savedCny: number;
  pricedCount: number;
  unmatchedPriceCount: number;
};
