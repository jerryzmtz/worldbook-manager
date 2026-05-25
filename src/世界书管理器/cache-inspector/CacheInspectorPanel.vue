<template>
  <section ref="panelElement" class="wbc-panel" aria-label="缓存命中对比">
    <div class="wbc-overview" data-wbm-cache-tutorial="overview">
      <article class="wbc-metric">
        <span>筛选记录</span>
        <strong>{{ formatNumber(visibleStats.count) }}</strong>
        <small>全部 {{ formatNumber(records.length) }}</small>
      </article>
      <article class="wbc-metric" :class="rateToneClass(visibleStats.latest)">
        <span>最新命中率</span>
        <strong>{{ visibleStats.latest ? formatRate(visibleStats.latest) : '-' }}</strong>
        <small>{{ visibleStats.latest ? visibleStats.latest.model : '无筛选结果' }}</small>
      </article>
      <article class="wbc-metric" :class="rateToneFromValue(visibleStats.weightedHitRate)" title="总命中 token / (总命中 token + 总未命中 token)">
        <span>加权平均命中率</span>
        <strong>{{ formatRateValue(visibleStats.weightedHitRate) }}</strong>
        <small>总命中 / 总可缓存 token</small>
      </article>
      <article class="wbc-metric">
        <span>命中 / 未命中</span>
        <strong :title="tokenBreakdownTooltip(visibleStats)">{{ formatTokenAmount(visibleStats.hitTokens) }} / {{ formatTokenAmount(visibleStats.missTokens) }}</strong>
        <small :title="tokenExactTooltip('输出', visibleStats.outputTokens)">输出 {{ formatTokenAmount(visibleStats.outputTokens) }} token</small>
      </article>
      <article class="wbc-metric">
        <span>预计花费</span>
        <strong>{{ formatCny(visibleStats.totalCny) }}</strong>
        <small>{{ priceCoverageLabel }}</small>
      </article>
      <article class="wbc-metric tone-high">
        <span>预计缓存节省</span>
        <strong>{{ formatCny(visibleStats.savedCny) }}</strong>
        <small>按命中 token 估算</small>
      </article>
    </div>

    <div class="wbc-toolbar" data-wbm-cache-tutorial="filters">
      <label class="wbc-field">
        <span>模型</span>
        <select v-model="filters.model">
          <option value="all">全部模型</option>
          <option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option>
        </select>
      </label>
      <label class="wbc-field">
        <span>缓存率</span>
        <select v-model="filters.cacheRate">
          <option value="all">全部</option>
          <option value="has_usage">有缓存数据</option>
          <option value="gt_zero">命中率 &gt; 0%</option>
          <option value="gte_30">命中率 >= 30%</option>
          <option value="gte_60">命中率 >= 60%</option>
          <option value="custom">自定义最小值</option>
        </select>
      </label>
      <label v-if="filters.cacheRate === 'custom'" class="wbc-field wbc-field-number">
        <span>最小 %</span>
        <input v-model.number="filters.customMinRate" type="number" min="0" max="100" step="1" />
      </label>
      <label class="wbc-field">
        <span>提示词</span>
        <select v-model="filters.diffability">
          <option value="all">全部记录</option>
          <option value="diffable">已保存提示词</option>
          <option value="stats_only">未保存提示词</option>
        </select>
      </label>
    </div>

    <div v-if="loadError" class="wbm-alert wbm-alert-error">{{ loadError }}</div>
    <div v-if="snapshotError" class="wbm-alert wbm-alert-error">{{ snapshotError }}</div>

    <div class="wbc-layout">
      <section class="wbc-records" data-wbm-cache-tutorial="records">
        <header class="wbc-section-head">
          <h3>请求记录</h3>
          <div class="wbc-record-header-actions">
            <button
              class="wbm-small-btn"
              type="button"
              data-wbm-cache-tutorial="usage-chart"
              @click="openUsageChart"
            >
              <i class="fa-solid fa-chart-column"></i>
              统计图
            </button>
            <button class="wbm-small-btn" type="button" :disabled="isLoading" @click="refreshRecords">
              <i class="fa-solid fa-rotate" :class="{ 'fa-spin': isLoading }"></i>
              刷新
            </button>
            <button class="wbm-danger-btn" type="button" :disabled="records.length === 0 || isClearing" @click="requestClearRecords">
              <i class="fa-solid fa-trash"></i>
              清空
            </button>
          </div>
        </header>

        <div class="wbc-record-list">
          <article
            v-for="record in visibleRecords"
            :key="record.id"
            class="wbc-record"
            :class="{
              'is-before': record.id === selectedBeforeId,
              'is-after': record.id === selectedAfterId,
              'is-stats-only': !record.snapshotAvailable,
              'is-pending': record.status === 'pending',
            }"
          >
            <button class="wbc-record-main" type="button" @click="selectRecord(record)">
              <span class="wbc-rate" :class="rateToneClass(record)">{{ formatRate(record) }}</span>
              <span class="wbc-record-text">
                <strong>{{ formatTime(record.timestamp) }}</strong>
                <small>{{ record.model }}</small>
                <small :title="recordTokenTooltip(record)">
                  {{ formatNumber(record.messageCount) }} 条 · {{ formatNumber(record.promptChars) }} 字 ·
                  {{ formatTokenLine(record) }}
                </small>
              </span>
              <span class="wbc-cost" :title="priceTooltip(record)">{{ recordCostLabel(record) }}</span>
              <span class="wbc-status" :class="`status-${record.status}`">
                <i v-if="record.status === 'pending'" class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                {{ statusLabel(record) }}
              </span>
            </button>
            <div class="wbc-record-actions" data-wbm-cache-tutorial="record-actions">
              <button
                class="wbc-choice-btn"
                type="button"
                :class="{ active: record.id === selectedBeforeId }"
                :disabled="!record.snapshotAvailable"
                :title="record.snapshotAvailable ? '设为旧请求' : '没有保存提示词，不能找断点'"
                @click.stop="setBefore(record)"
              >
                旧
              </button>
              <button
                class="wbc-choice-btn"
                type="button"
                :class="{ active: record.id === selectedAfterId }"
                :disabled="!record.snapshotAvailable"
                :title="record.snapshotAvailable ? '设为新请求' : '没有保存提示词，不能找断点'"
                @click.stop="setAfter(record)"
              >
                新
              </button>
            </div>
          </article>
          <div v-if="visibleRecords.length === 0" class="wbm-empty">暂无可显示的缓存记录。</div>
        </div>
      </section>

      <section class="wbc-diff" data-wbm-cache-tutorial="diff">
        <header class="wbc-section-head">
          <h3>断点对比</h3>
          <div class="wbc-head-actions" data-wbm-cache-tutorial="diff-actions">
            <button
              v-if="canShowFullText"
              class="wbm-small-btn"
              type="button"
              :disabled="fullText.loading"
              @click="jumpToBreakpoint"
            >
              <i class="fa-solid fa-location-crosshairs"></i>
              跳到断点
            </button>
            <button
              v-if="canShowFullText"
              class="wbm-small-btn"
              type="button"
              :disabled="fullText.loading"
              @click="toggleFullText"
            >
              <i class="fa-solid" :class="fullText.open ? 'fa-compress' : 'fa-expand'"></i>
              {{ fullText.open ? '收起全文' : '展开全文' }}
            </button>
          </div>
        </header>

        <div v-if="!selectedBeforeId || !selectedAfterId" class="wbc-empty-state">
          <i class="fa-solid fa-code-compare"></i>
          <span>请选择旧请求和新请求进行对比。</span>
        </div>
        <div v-else-if="isDiffLoading" class="wbc-empty-state">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span>读取提示词快照...</span>
        </div>
        <div v-else-if="!selectedBeforeSnapshot || !selectedAfterSnapshot" class="wbc-empty-state">
          <i class="fa-solid fa-box-archive"></i>
          <span>这条记录没有保存提示词，不能找断点。</span>
        </div>
        <div v-else class="wbc-diff-body">
          <div class="wbc-diff-summary" :class="`kind-${diffResult.kind}`">
            <strong>{{ diffResult.summary }}</strong>
            <span v-if="diffResult.index !== null">
              {{ diffIndexLabel }} · {{ diffResult.beforeRole || '-' }} → {{ diffResult.afterRole || '-' }}
            </span>
          </div>

          <div v-if="diffResult.context" class="wbc-diff-grid">
            <article class="wbc-diff-side">
              <h4>旧请求 · {{ formatNumber(diffResult.beforeLength) }} 字</h4>
              <pre><span v-if="diffResult.context.hasMorePrefix" class="wbc-context">…</span><span class="wbc-context">{{ diffResult.context.prefix }}</span><mark :id="contextBreakpointId('before')" class="wbc-del">{{ truncatedBeforeChange }}</mark><span class="wbc-context">{{ diffResult.context.suffix }}</span><span v-if="diffResult.context.hasMoreSuffix" class="wbc-context">…</span></pre>
            </article>
            <article class="wbc-diff-side">
              <h4>新请求 · {{ formatNumber(diffResult.afterLength) }} 字</h4>
              <pre><span v-if="diffResult.context.hasMorePrefix" class="wbc-context">…</span><span class="wbc-context">{{ diffResult.context.prefix }}</span><mark :id="contextBreakpointId('after')" class="wbc-ins">{{ truncatedAfterChange }}</mark><span class="wbc-context">{{ diffResult.context.suffix }}</span><span v-if="diffResult.context.hasMoreSuffix" class="wbc-context">…</span></pre>
            </article>
          </div>

          <div v-else class="wbc-empty-state compact">
            <i class="fa-solid fa-check"></i>
            <span>没有发现 messages 差异。</span>
          </div>

          <div v-if="fullText.open" class="wbc-full-text">
            <div class="wbc-full-head">
              <strong>全文高亮</strong>
              <span v-if="fullText.loading">分批加载中...</span>
            </div>
            <div class="wbc-diff-grid">
              <article class="wbc-diff-side">
                <h4>旧请求</h4>
                <pre><template v-for="segment in beforeFullSegments" :key="segment.id"><mark v-if="segment.kind === 'changed'" :id="segment.marker ? fullBreakpointId('before') : undefined" class="wbc-del">{{ segment.text }}</mark><span v-else>{{ segment.text }}</span></template><span v-if="fullText.loading" class="wbc-loading-tail">…</span></pre>
              </article>
              <article class="wbc-diff-side">
                <h4>新请求</h4>
                <pre><template v-for="segment in afterFullSegments" :key="segment.id"><mark v-if="segment.kind === 'changed'" :id="segment.marker ? fullBreakpointId('after') : undefined" class="wbc-ins">{{ segment.text }}</mark><span v-else>{{ segment.text }}</span></template><span v-if="fullText.loading" class="wbc-loading-tail">…</span></pre>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="usageChartOpen" class="wbm-confirm wbc-modal wbc-usage-modal" @click.self="closeUsageChart">
      <section class="wbc-modal-box wbc-usage-box" role="dialog" aria-modal="true" aria-label="缓存统计图">
        <header class="wbc-modal-head">
          <div>
            <h3>统计图</h3>
            <p>{{ usageChartScopeLabel }} · 最近 {{ usageChartData.dayCount }} 天</p>
          </div>
          <button class="wbc-modal-close" type="button" aria-label="关闭统计图" @click="closeUsageChart">
            <i class="fa-solid fa-times"></i>
          </button>
        </header>

        <div class="wbc-usage-summary">
          <article>
            <span>请求次数</span>
            <strong>{{ formatNumber(usageChartData.requestCount) }}</strong>
            <small>{{ formatNumber(usageChartData.modelSummaries.length) }} 个模型</small>
          </article>
          <article>
            <span>预计花费</span>
            <strong>{{ formatCny(usageChartData.totalCny) }}</strong>
            <small>{{ usageChartPriceLabel }}</small>
          </article>
          <article class="tone-high">
            <span>预计缓存节省</span>
            <strong>{{ formatCny(usageChartData.savedCny) }}</strong>
            <small>按命中 token 估算</small>
          </article>
          <article>
            <span>Tokens</span>
            <strong :title="tokenExactTooltip('总量', usageChartData.totalTokens)">{{ formatTokenAmount(usageChartData.totalTokens) }}</strong>
            <small :title="tokenBreakdownTooltip(usageChartData)">{{ formatTokenBreakdown(usageChartData) }}</small>
          </article>
        </div>

        <div v-if="usageChartData.requestCount === 0" class="wbc-empty-state compact">
          <i class="fa-solid fa-chart-column"></i>
          <span>当前筛选在最近 {{ usageChartData.dayCount }} 天内没有可统计记录。</span>
        </div>
        <template v-else>
          <div class="wbc-chart-grid">
            <article class="wbc-chart-card">
              <header>
                <h4>每日花费</h4>
                <span>{{ formatCny(usageChartData.totalCny) }}</span>
              </header>
              <svg class="wbc-chart-svg" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="每日花费柱状图">
                <line class="wbc-axis-line" :x1="CHART_LEFT" :x2="CHART_RIGHT" :y1="CHART_BASELINE" :y2="CHART_BASELINE" />
                <rect
                  v-for="bar in spendBars"
                  :key="bar.id"
                  :class="bar.className"
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.width"
                  :height="bar.height"
                  rx="2"
                >
                  <title>{{ bar.label }}</title>
                </rect>
              </svg>
              <div class="wbc-chart-axis">
                <span>{{ usageChartData.startLabel }}</span>
                <span>{{ usageChartData.endLabel }}</span>
              </div>
            </article>

            <article class="wbc-chart-card">
              <header>
                <h4>每日节省</h4>
                <span>{{ formatCny(usageChartData.savedCny) }}</span>
              </header>
              <svg class="wbc-chart-svg" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="每日缓存节省柱状图">
                <line class="wbc-axis-line" :x1="CHART_LEFT" :x2="CHART_RIGHT" :y1="CHART_BASELINE" :y2="CHART_BASELINE" />
                <rect
                  v-for="bar in savingBars"
                  :key="bar.id"
                  :class="bar.className"
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.width"
                  :height="bar.height"
                  rx="2"
                >
                  <title>{{ bar.label }}</title>
                </rect>
              </svg>
              <div class="wbc-chart-axis">
                <span>{{ usageChartData.startLabel }}</span>
                <span>{{ usageChartData.endLabel }}</span>
              </div>
            </article>

            <article class="wbc-chart-card">
              <header>
                <h4>API 请求次数</h4>
                <span>{{ formatNumber(usageChartData.requestCount) }}</span>
              </header>
              <svg class="wbc-chart-svg" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="API 请求次数折线图">
                <line class="wbc-axis-line" :x1="CHART_LEFT" :x2="CHART_RIGHT" :y1="CHART_BASELINE" :y2="CHART_BASELINE" />
                <path v-if="requestAreaPath" class="wbc-line-area" :d="requestAreaPath" />
                <path v-if="requestLinePath" class="wbc-line-path" :d="requestLinePath" />
                <circle
                  v-for="point in requestLine.points"
                  :key="point.id"
                  class="wbc-line-point"
                  :cx="point.x"
                  :cy="point.y"
                  r="2"
                >
                  <title>{{ point.label }}</title>
                </circle>
              </svg>
              <div class="wbc-chart-axis">
                <span>{{ usageChartData.startLabel }}</span>
                <span>{{ usageChartData.endLabel }}</span>
              </div>
            </article>

            <article class="wbc-chart-card">
              <header>
                <h4>Tokens</h4>
                <span :title="tokenExactTooltip('总量', usageChartData.totalTokens)">{{ formatTokenAmount(usageChartData.totalTokens) }}</span>
              </header>
              <svg class="wbc-chart-svg" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="Tokens 堆叠柱状图">
                <line class="wbc-axis-line" :x1="CHART_LEFT" :x2="CHART_RIGHT" :y1="CHART_BASELINE" :y2="CHART_BASELINE" />
                <rect
                  v-for="bar in tokenStackBars"
                  :key="bar.id"
                  :class="bar.className"
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.width"
                  :height="bar.height"
                  rx="2"
                >
                  <title>{{ bar.label }}</title>
                </rect>
              </svg>
              <div class="wbc-chart-legend">
                <span><i class="legend-hit"></i>命中</span>
                <span><i class="legend-miss"></i>未命中</span>
                <span><i class="legend-output"></i>输出</span>
              </div>
            </article>
          </div>

          <section class="wbc-model-summary">
            <header>
              <h4>模型汇总</h4>
              <span>当前筛选 · 最近 {{ usageChartData.dayCount }} 天</span>
            </header>
            <div class="wbc-model-list">
              <article v-for="model in usageChartData.modelSummaries" :key="model.model" class="wbc-model-row">
                <strong>{{ model.model }}</strong>
                <span>{{ formatNumber(model.requestCount) }} 次</span>
                <span :title="tokenExactTooltip(model.model, model.totalTokens)">{{ formatTokenAmount(model.totalTokens) }} tokens</span>
                <span>{{ formatCny(model.totalCny) }}</span>
              </article>
            </div>
          </section>
        </template>
      </section>
    </div>

    <div v-if="clearConfirmOpen" class="wbm-confirm wbc-modal wbc-confirm-modal" @click.self="cancelClearRecords">
      <section class="wbc-modal-box wbc-confirm-box" role="dialog" aria-modal="true" aria-label="清空缓存记录">
        <h3>清空缓存记录</h3>
        <p>将删除所有缓存命中记录、提示词快照和统计数据。这个操作不会影响聊天内容或世界书。</p>
        <div class="wbc-dialog-actions">
          <button class="wbm-small-btn" type="button" :disabled="isClearing" @click="cancelClearRecords">取消</button>
          <button class="wbm-danger-btn" type="button" :disabled="isClearing" @click="confirmClearRecords">
            <i class="fa-solid" :class="isClearing ? 'fa-circle-notch fa-spin' : 'fa-trash'"></i>
            确认清空
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
  buildCacheUsageChartData,
  type CacheUsageChartBucket,
  type CacheUsageModelSummary,
} from './analytics';
import { EXCHANGE_RATE_UPDATED_EVENT, refreshUsdToCnyRate } from './exchange-rate';
import {
  buildFullTextSegments,
  CACHE_RECORDS_CHANGED_EVENT,
  clearCacheRecords,
  comparePromptRecords,
  estimateCacheCost,
  getPromptSnapshot,
  listCacheSummaries,
  type CacheRecordFilterState,
  type CacheRecordsChangedEvent,
  type CacheSummaryRecord,
  type CacheVisibleStats,
  type PromptSnapshotRecord,
} from '.';

const CHUNK_SIZE = 20_000;
const ALL_MODELS = 'all';
const CHART_WIDTH = 320;
const CHART_HEIGHT = 132;
const CHART_TOP = 12;
const CHART_BASELINE = 116;
const CHART_LEFT = 12;
const CHART_RIGHT = 308;
const PENDING_RECORD_REFRESH_DELAY_MS = 500;
const PANEL_TRACE_LIMIT = 300;

type BarMark = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  className: string;
  label: string;
};

type LineMark = {
  id: string;
  x: number;
  y: number;
  label: string;
};

type TokenBreakdown = {
  hitTokens: number;
  missTokens: number;
  outputTokens: number;
};

type CacheInspectorTraceEntry = {
  at: string;
  ms: number;
  stage: string;
  details?: Record<string, unknown>;
};

type CacheInspectorTraceWindow = Window & {
  __wbmCacheInspectorTrace?: CacheInspectorTraceEntry[];
  __wbmCacheInspectorTraceDump?: () => CacheInspectorTraceEntry[];
};

const CACHE_FILTER_PREF_KEY = 'worldbook_manager_cache_inspector_filters_v1';
const panelElement = ref<HTMLElement | null>(null);
const records = ref<CacheSummaryRecord[]>([]);
const snapshotCache = reactive(new Map<string, PromptSnapshotRecord | null>());
const snapshotLoadingIds = reactive(new Set<string>());
const isLoading = ref(false);
const isClearing = ref(false);
const loadError = ref('');
const snapshotError = ref('');
const clearConfirmOpen = ref(false);
const usageChartOpen = ref(false);
const selectedBeforeId = ref<string | null>(null);
const selectedAfterId = ref<string | null>(null);
const exchangeRateVersion = ref(0);
const filters = reactive<CacheRecordFilterState>(readCacheFilterPreference());
const fullText = reactive({
  open: false,
  loading: false,
  beforeLimit: 0,
  afterLimit: 0,
  token: 0,
});
let pendingRecordsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRecordsRefreshRunning = false;

const modelOptions = computed(() => {
  const models = new Set(records.value.map(record => record.model).filter(Boolean));
  return Array.from(models).sort((left, right) => left.localeCompare(right));
});
const visibleRecords = computed(() => records.value.filter(record => matchesFilters(record)));
const visibleStats = computed<CacheVisibleStats>(() => {
  void exchangeRateVersion.value;
  return buildVisibleStats(visibleRecords.value);
});
const selectedBeforeSnapshot = computed(() =>
  selectedBeforeId.value ? snapshotCache.get(selectedBeforeId.value) ?? null : null,
);
const selectedAfterSnapshot = computed(() =>
  selectedAfterId.value ? snapshotCache.get(selectedAfterId.value) ?? null : null,
);
const isDiffLoading = computed(
  () =>
    (selectedBeforeId.value ? snapshotLoadingIds.has(selectedBeforeId.value) : false) ||
    (selectedAfterId.value ? snapshotLoadingIds.has(selectedAfterId.value) : false),
);
const diffResult = computed(() => comparePromptRecords(selectedBeforeSnapshot.value, selectedAfterSnapshot.value));
const canShowFullText = computed(
  () =>
    (diffResult.value.beforeIndex !== null || diffResult.value.afterIndex !== null) &&
    !!selectedBeforeSnapshot.value &&
    !!selectedAfterSnapshot.value,
);
const beforeFullText = computed(() => fullMessageText(selectedBeforeSnapshot.value, diffResult.value.beforeIndex));
const afterFullText = computed(() => fullMessageText(selectedAfterSnapshot.value, diffResult.value.afterIndex));
const beforeFullSegments = computed(() =>
  buildFullTextSegments(
    beforeFullText.value,
    diffResult.value.context?.beforeRange ?? null,
    fullText.beforeLimit,
    'before',
  ),
);
const afterFullSegments = computed(() =>
  buildFullTextSegments(afterFullText.value, diffResult.value.context?.afterRange ?? null, fullText.afterLimit, 'after'),
);
const truncatedBeforeChange = computed(() =>
  changedTextLabel(diffResult.value.context?.beforeChanged ?? '', diffResult.value.context?.beforeChangedLength ?? 0),
);
const truncatedAfterChange = computed(() =>
  changedTextLabel(diffResult.value.context?.afterChanged ?? '', diffResult.value.context?.afterChangedLength ?? 0),
);
const diffIndexLabel = computed(() => {
  const beforeIndex = diffResult.value.beforeIndex;
  const afterIndex = diffResult.value.afterIndex;
  if (beforeIndex !== null && afterIndex !== null) {
    return beforeIndex === afterIndex ? `#${beforeIndex + 1}` : `#${beforeIndex + 1} → #${afterIndex + 1}`;
  }
  if (beforeIndex !== null) return `#${beforeIndex + 1} → -`;
  if (afterIndex !== null) return `- → #${afterIndex + 1}`;
  return diffResult.value.index === null ? '' : `#${diffResult.value.index + 1}`;
});
const priceCoverageLabel = computed(() => {
  if (visibleStats.value.count === 0) return '无筛选结果';
  if (visibleStats.value.unmatchedPriceCount === 0) return `${formatNumber(visibleStats.value.pricedCount)} 条已匹配`;
  return `${formatNumber(visibleStats.value.pricedCount)} 条已匹配 · ${formatNumber(visibleStats.value.unmatchedPriceCount)} 条未匹配`;
});
const usageChartData = computed(() => {
  void exchangeRateVersion.value;
  return buildCacheUsageChartData(visibleRecords.value);
});
const usageChartScopeLabel = computed(() => buildUsageChartScopeLabel());
const usageChartPriceLabel = computed(() => {
  if (usageChartData.value.requestCount === 0) return '无统计记录';
  if (usageChartData.value.unmatchedPriceCount === 0) return `${formatNumber(usageChartData.value.pricedCount)} 条已匹配`;
  return `${formatNumber(usageChartData.value.pricedCount)} 条已匹配 · ${formatNumber(usageChartData.value.unmatchedPriceCount)} 条未匹配`;
});
const spendBars = computed(() =>
  buildBarMarks(usageChartData.value.buckets, bucket => bucket.totalCny, 'wbc-bar-cost', formatCny),
);
const savingBars = computed(() =>
  buildBarMarks(usageChartData.value.buckets, bucket => bucket.savedCny, 'wbc-bar-saving', formatCny),
);
const tokenStackBars = computed(() => buildTokenStackBars(usageChartData.value.buckets));
const requestLine = computed(() => buildLineMarks(usageChartData.value.buckets, bucket => bucket.requestCount));
const requestLinePath = computed(() => linePath(requestLine.value.points));
const requestAreaPath = computed(() => areaPath(requestLine.value.points));

onMounted(() => {
  logPanelTrace('panel.mount');
  void refreshRecords();
  void refreshUsdToCnyRate();
  window.addEventListener(CACHE_RECORDS_CHANGED_EVENT, handleRecordsChanged as EventListener);
  window.addEventListener(EXCHANGE_RATE_UPDATED_EVENT, handleExchangeRateUpdated as EventListener);
  window.visualViewport?.addEventListener('resize', handleCacheModalViewportChange);
  window.visualViewport?.addEventListener('scroll', handleCacheModalViewportChange);
  window.addEventListener('resize', handleCacheModalViewportChange);
});

onUnmounted(() => {
  clearPendingRecordsRefreshTimer();
  window.removeEventListener(CACHE_RECORDS_CHANGED_EVENT, handleRecordsChanged as EventListener);
  window.removeEventListener(EXCHANGE_RATE_UPDATED_EVENT, handleExchangeRateUpdated as EventListener);
  window.visualViewport?.removeEventListener('resize', handleCacheModalViewportChange);
  window.visualViewport?.removeEventListener('scroll', handleCacheModalViewportChange);
  window.removeEventListener('resize', handleCacheModalViewportChange);
});

watch([selectedBeforeId, selectedAfterId], ([beforeId, afterId]) => {
  resetFullText();
  void loadSelectedSnapshots(beforeId, afterId);
});

watch([usageChartOpen, clearConfirmOpen], ([isUsageChartOpen, isClearConfirmOpen]) => {
  if (isUsageChartOpen || isClearConfirmOpen) scheduleCacheModalViewportSync();
});

watch(filters, persistCacheFilterPreference, { deep: true });

async function refreshRecords(): Promise<void> {
  clearPendingRecordsRefreshTimer();
  isLoading.value = true;
  loadError.value = '';
  try {
    records.value = filterDisplayableRecords(await listCacheSummaries());
    pruneSelection();
  } catch (error) {
    loadError.value = `读取缓存记录失败：${formatError(error)}`;
  } finally {
    isLoading.value = false;
    schedulePendingRecordsRefresh();
  }
}

function openUsageChart(): void {
  usageChartOpen.value = true;
  scheduleCacheModalViewportSync();
}

function closeUsageChart(): void {
  usageChartOpen.value = false;
}

function requestClearRecords(): void {
  if (records.value.length === 0) return;
  clearConfirmOpen.value = true;
  scheduleCacheModalViewportSync();
}

function cancelClearRecords(): void {
  if (isClearing.value) return;
  clearConfirmOpen.value = false;
}

async function confirmClearRecords(): Promise<void> {
  isClearing.value = true;
  loadError.value = '';
  try {
    await clearCacheRecords();
    records.value = [];
    clearPendingRecordsRefreshTimer();
    snapshotCache.clear();
    snapshotLoadingIds.clear();
    selectedBeforeId.value = null;
    selectedAfterId.value = null;
    clearConfirmOpen.value = false;
    usageChartOpen.value = false;
    resetFullText();
  } catch (error) {
    loadError.value = `清空缓存记录失败：${formatError(error)}`;
  } finally {
    isClearing.value = false;
  }
}

function upsertRecord(summary: CacheSummaryRecord): void {
  if (!isDisplayableRecord(summary)) {
    records.value = records.value.filter(record => record.id !== summary.id);
    pruneSelection();
    return;
  }
  logPanelTrace('panel.event.upsert', {
    id: summary.id,
    status: summary.status,
    model: summary.model,
    hitTokens: summary.hitTokens,
    missTokens: summary.missTokens,
    totalTokens: summary.totalTokens,
  });
  const existingIndex = records.value.findIndex(record => record.id === summary.id);
  const nextRecord = { ...summary };
  if (existingIndex >= 0) {
    const nextRecords = records.value.slice();
    nextRecords[existingIndex] = nextRecord;
    records.value = nextRecords.sort(sortRecordsByTimestampDesc);
  } else {
    records.value = [nextRecord, ...records.value].sort(sortRecordsByTimestampDesc);
  }
  pruneSelection();
  schedulePendingRecordsRefresh();
}

function handleRecordsChanged(event: CacheRecordsChangedEvent): void {
  logPanelTrace('panel.event.records-changed', {
    recordId: event.detail?.recordId ?? null,
    status: event.detail?.summary?.status ?? null,
    model: event.detail?.summary?.model ?? null,
  });
  if (event.detail?.summary) {
    upsertRecord(event.detail.summary);
    return;
  }
  void refreshRecords();
}

function handleExchangeRateUpdated(): void {
  exchangeRateVersion.value += 1;
}

function handleCacheModalViewportChange(): void {
  if (usageChartOpen.value || clearConfirmOpen.value) scheduleCacheModalViewportSync();
}

function scheduleCacheModalViewportSync(): void {
  void nextTick(() => {
    syncCacheModalViewport();
  });
}

function hasPendingRecords(): boolean {
  return records.value.some(record => record.status === 'pending');
}

function schedulePendingRecordsRefresh(): void {
  if (pendingRecordsRefreshTimer !== null || isClearing.value || !hasPendingRecords()) return;
  logPanelTrace('panel.pending.refresh.schedule', {
    delayMs: PENDING_RECORD_REFRESH_DELAY_MS,
    pendingIds: records.value.filter(record => record.status === 'pending').map(record => record.id).slice(0, 20),
  });
  pendingRecordsRefreshTimer = setTimeout(() => {
    pendingRecordsRefreshTimer = null;
    void refreshPendingRecordsFromStorage();
  }, PENDING_RECORD_REFRESH_DELAY_MS);
}

function clearPendingRecordsRefreshTimer(): void {
  if (pendingRecordsRefreshTimer === null) return;
  clearTimeout(pendingRecordsRefreshTimer);
  pendingRecordsRefreshTimer = null;
}

async function refreshPendingRecordsFromStorage(): Promise<void> {
  if (pendingRecordsRefreshRunning || isLoading.value || isClearing.value) {
    schedulePendingRecordsRefresh();
    return;
  }
  if (!hasPendingRecords()) return;

  pendingRecordsRefreshRunning = true;
  try {
    const beforePendingIds = new Set(records.value.filter(record => record.status === 'pending').map(record => record.id));
    const storedRecords = filterDisplayableRecords(await listCacheSummaries());
    const transitions = storedRecords
      .filter(record => beforePendingIds.has(record.id) && record.status !== 'pending')
      .map(record => ({
        id: record.id,
        status: record.status,
        hitTokens: record.hitTokens,
        missTokens: record.missTokens,
        totalTokens: record.totalTokens,
        errorMessage: record.errorMessage,
      }));
    logPanelTrace('panel.pending.refresh.result', {
      beforePendingCount: beforePendingIds.size,
      storedCount: storedRecords.length,
      transitions,
    });
    records.value = mergeStoredCacheSummaries(records.value, storedRecords);
    pruneSelection();
  } catch (error) {
    logPanelTrace('panel.pending.refresh.failed', {
      error: formatError(error),
    });
    // 后台补偿刷新失败不打断面板；pending 仍存在时会继续尝试。
  } finally {
    pendingRecordsRefreshRunning = false;
    schedulePendingRecordsRefresh();
  }
}

function mergeStoredCacheSummaries(
  currentRecords: CacheSummaryRecord[],
  storedRecords: CacheSummaryRecord[],
): CacheSummaryRecord[] {
  const nextRecordsById = new Map(filterDisplayableRecords(currentRecords).map(record => [record.id, record]));
  for (const record of filterDisplayableRecords(storedRecords)) {
    nextRecordsById.set(record.id, { ...record });
  }
  return Array.from(nextRecordsById.values()).sort(sortRecordsByTimestampDesc);
}

function filterDisplayableRecords(items: CacheSummaryRecord[]): CacheSummaryRecord[] {
  return items.filter(isDisplayableRecord);
}

function isDisplayableRecord(record: CacheSummaryRecord): boolean {
  return record.status !== 'pending';
}

function sortRecordsByTimestampDesc(left: CacheSummaryRecord, right: CacheSummaryRecord): number {
  return right.timestamp - left.timestamp;
}

function logPanelTrace(stage: string, details?: Record<string, unknown>): void {
  const entry: CacheInspectorTraceEntry = {
    at: new Date().toISOString(),
    ms: Date.now(),
    stage,
  };
  if (details) entry.details = details;
  try {
    const traceWindow = window as CacheInspectorTraceWindow;
    const trace = traceWindow.__wbmCacheInspectorTrace ?? [];
    trace.push(entry);
    if (trace.length > PANEL_TRACE_LIMIT) trace.splice(0, trace.length - PANEL_TRACE_LIMIT);
    traceWindow.__wbmCacheInspectorTrace = trace;
    traceWindow.__wbmCacheInspectorTraceDump = () => trace.slice();
  } catch {
    // 诊断日志不能影响面板本身。
  }
  console.log(`[缓存命中对比][trace] ${stage}`, details ?? {});
}

function syncCacheModalViewport(): void {
  const panel = panelElement.value;
  const dialogElement = panel?.closest<HTMLElement>('.wbm-dialog') ?? null;
  const rootElement = panel?.closest<HTMLElement>('.wbm-overlay') ?? dialogElement;
  const hostElement = dialogElement ?? panel;
  if (!hostElement) return;

  const hostRect = hostElement.getBoundingClientRect();
  const rootRect = rootElement?.getBoundingClientRect();
  const scrollWidth = Math.max(hostElement.scrollWidth, hostElement.clientWidth, rootElement?.scrollWidth ?? 0);
  const scrollHeight = Math.max(hostElement.scrollHeight, hostElement.clientHeight, rootElement?.scrollHeight ?? 0);
  const viewportWidth = Math.max(
    320,
    Math.round(hostElement.clientWidth || hostRect.width || rootRect?.width || scrollWidth || 0),
  );
  const viewportHeight = Math.max(
    320,
    Math.round(hostElement.clientHeight || hostRect.height || rootRect?.height || Math.min(scrollHeight, 720) || 0),
  );
  const viewportTop = Math.max(0, Math.round(hostElement.scrollTop || 0));
  const isMobileViewport = viewportWidth <= 760;

  getCacheModalElements().forEach(modal => {
    const isMobileUsageChart = isMobileViewport && modal.classList.contains('wbc-usage-modal');
    modal.style.setProperty('position', 'absolute', 'important');
    modal.style.setProperty('top', `${viewportTop}px`, 'important');
    modal.style.setProperty('left', '0', 'important');
    modal.style.setProperty('right', 'auto', 'important');
    modal.style.setProperty('bottom', 'auto', 'important');
    modal.style.setProperty('width', `${viewportWidth}px`, 'important');
    modal.style.setProperty('height', `${viewportHeight}px`, 'important');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('align-items', isMobileUsageChart ? 'stretch' : 'center', 'important');
    modal.style.setProperty('justify-content', 'center', 'important');
    modal.style.setProperty('box-sizing', 'border-box', 'important');
    modal.style.setProperty('z-index', '31400', 'important');
    modal.style.setProperty('padding', isMobileUsageChart ? '0' : '10px', 'important');
  });
}

function getCacheModalElements(): HTMLElement[] {
  const panel = panelElement.value;
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>('.wbc-modal')) : [];
}

function matchesFilters(record: CacheSummaryRecord): boolean {
  if (!isDisplayableRecord(record)) return false;
  if (filters.model !== ALL_MODELS && record.model !== filters.model) return false;
  if (filters.diffability === 'diffable' && !record.snapshotAvailable) return false;
  if (filters.diffability === 'stats_only' && record.snapshotAvailable) return false;
  if (!matchesCacheRateFilter(record)) return false;
  return true;
}

function matchesCacheRateFilter(record: CacheSummaryRecord): boolean {
  if (filters.cacheRate === 'all') return true;
  if (filters.cacheRate === 'has_usage') return record.hitRate !== null && record.totalCacheTokens > 0;
  if (filters.cacheRate === 'gt_zero') return record.hitRate !== null && record.hitRate > 0;
  if (filters.cacheRate === 'gte_30') return record.hitRate !== null && record.hitRate >= 0.3;
  if (filters.cacheRate === 'gte_60') return record.hitRate !== null && record.hitRate >= 0.6;
  const minRate = Math.min(100, Math.max(0, Number(filters.customMinRate) || 0)) / 100;
  return record.hitRate !== null && record.hitRate >= minRate;
}

function readCacheFilterPreference(): CacheRecordFilterState {
  const fallback: CacheRecordFilterState = {
    model: ALL_MODELS,
    cacheRate: 'all',
    customMinRate: 0,
    diffability: 'all',
  };
  try {
    const raw = window.localStorage?.getItem(CACHE_FILTER_PREF_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (!isRecord(value)) return fallback;
    return {
      model: typeof value.model === 'string' && value.model.trim() ? value.model : fallback.model,
      cacheRate: isCacheRateFilter(value.cacheRate) ? value.cacheRate : fallback.cacheRate,
      customMinRate: normalizeCustomMinRate(value.customMinRate),
      diffability: isCacheDiffabilityFilter(value.diffability) ? value.diffability : fallback.diffability,
    };
  } catch (error) {
    console.warn(`[缓存命中对比] 读取过滤器偏好失败：${formatError(error)}`);
    return fallback;
  }
}

function persistCacheFilterPreference(): void {
  try {
    window.localStorage?.setItem(
      CACHE_FILTER_PREF_KEY,
      JSON.stringify({
        model: filters.model,
        cacheRate: filters.cacheRate,
        customMinRate: normalizeCustomMinRate(filters.customMinRate),
        diffability: filters.diffability,
      } satisfies CacheRecordFilterState),
    );
  } catch (error) {
    console.warn(`[缓存命中对比] 保存过滤器偏好失败：${formatError(error)}`);
  }
}

function isCacheRateFilter(value: unknown): value is CacheRecordFilterState['cacheRate'] {
  return ['all', 'has_usage', 'gt_zero', 'gte_30', 'gte_60', 'custom'].includes(String(value));
}

function isCacheDiffabilityFilter(value: unknown): value is CacheRecordFilterState['diffability'] {
  return value === 'all' || value === 'diffable' || value === 'stats_only';
}

function normalizeCustomMinRate(value: unknown): number {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildVisibleStats(items: CacheSummaryRecord[]): CacheVisibleStats {
  const hitTokens = items.reduce((sum, record) => sum + record.hitTokens, 0);
  const missTokens = items.reduce((sum, record) => sum + record.missTokens, 0);
  const pricedItems = items
    .map(record => priceForRecord(record).costSnapshot)
    .filter(costSnapshot => costSnapshot !== null);
  const unmatchedPriceCount = items.filter(record => shouldCountAsUnmatchedPrice(record)).length;
  return {
    count: items.length,
    latest: items[0] ?? null,
    hitTokens,
    missTokens,
    outputTokens: items.reduce((sum, record) => sum + record.outputTokens, 0),
    weightedHitRate: hitTokens + missTokens > 0 ? hitTokens / (hitTokens + missTokens) : null,
    totalCny: pricedItems.reduce((sum, costSnapshot) => sum + costSnapshot.totalCny, 0),
    savedCny: pricedItems.reduce((sum, costSnapshot) => sum + costSnapshot.savedCny, 0),
    pricedCount: pricedItems.length,
    unmatchedPriceCount,
  };
}

function shouldCountAsUnmatchedPrice(record: CacheSummaryRecord): boolean {
  if (record.status !== 'completed') return false;
  if (record.totalCacheTokens + record.outputTokens <= 0) return false;
  return !priceForRecord(record).costSnapshot;
}

function buildUsageChartScopeLabel(): string {
  const parts = [
    filters.model === ALL_MODELS ? '全部模型' : filters.model,
    cacheRateFilterLabel(filters.cacheRate),
    promptSnapshotFilterLabel(filters.diffability),
  ];
  return `当前筛选：${parts.join(' · ')}`;
}

function cacheRateFilterLabel(value: CacheRecordFilterState['cacheRate']): string {
  if (value === 'has_usage') return '有缓存数据';
  if (value === 'gt_zero') return '命中率 > 0%';
  if (value === 'gte_30') return '命中率 ≥ 30%';
  if (value === 'gte_60') return '命中率 ≥ 60%';
  if (value === 'custom') return `命中率 ≥ ${Math.min(100, Math.max(0, Number(filters.customMinRate) || 0))}%`;
  return '全部缓存率';
}

function promptSnapshotFilterLabel(value: CacheRecordFilterState['diffability']): string {
  if (value === 'diffable') return '已保存提示词';
  if (value === 'stats_only') return '未保存提示词';
  return '全部提示词';
}

function buildBarMarks(
  buckets: CacheUsageChartBucket[],
  getValue: (bucket: CacheUsageChartBucket) => number,
  className: string,
  formatValue: (value: number) => string,
): BarMark[] {
  const values = buckets.map(bucket => Math.max(0, getValue(bucket)));
  const maxValue = Math.max(...values, 0);
  const layout = buildBarLayout(buckets.length);
  return buckets.map((bucket, index) => {
    const value = values[index] ?? 0;
    const height = maxValue > 0 && value > 0 ? Math.max(1, (value / maxValue) * chartInnerHeight()) : 0;
    return {
      id: `${bucket.key}-${className}`,
      x: layout.x(index),
      y: CHART_BASELINE - height,
      width: layout.width,
      height,
      className,
      label: `${bucket.label} · ${formatValue(value)}`,
    };
  });
}

function buildTokenStackBars(buckets: CacheUsageChartBucket[]): BarMark[] {
  const maxValue = Math.max(...buckets.map(bucket => bucket.hitTokens + bucket.missTokens + bucket.outputTokens), 0);
  const layout = buildBarLayout(buckets.length);
  const bars: BarMark[] = [];

  buckets.forEach((bucket, index) => {
    const segments = [
      { key: 'miss', label: '未命中', value: bucket.missTokens, className: 'wbc-bar-miss' },
      { key: 'output', label: '输出', value: bucket.outputTokens, className: 'wbc-bar-output' },
      { key: 'hit', label: '命中', value: bucket.hitTokens, className: 'wbc-bar-hit' },
    ];
    let y = CHART_BASELINE;
    for (const segment of segments) {
      const height = maxValue > 0 && segment.value > 0 ? Math.max(1, (segment.value / maxValue) * chartInnerHeight()) : 0;
      y -= height;
      bars.push({
        id: `${bucket.key}-${segment.key}`,
        x: layout.x(index),
        y,
        width: layout.width,
        height,
        className: segment.className,
        label: tokenChartMarkLabel(bucket.label, segment.label, segment.value),
      });
    }
  });

  return bars;
}

function buildLineMarks(
  buckets: CacheUsageChartBucket[],
  getValue: (bucket: CacheUsageChartBucket) => number,
): { points: LineMark[] } {
  const maxValue = Math.max(...buckets.map(bucket => Math.max(0, getValue(bucket))), 0);
  const span = CHART_RIGHT - CHART_LEFT;
  const denominator = Math.max(1, buckets.length - 1);
  return {
    points: buckets.map((bucket, index) => {
      const value = Math.max(0, getValue(bucket));
      const ratio = maxValue > 0 ? value / maxValue : 0;
      return {
        id: bucket.key,
        x: CHART_LEFT + (span * index) / denominator,
        y: CHART_BASELINE - ratio * chartInnerHeight(),
        label: `${bucket.label} · ${formatNumber(value)} 次`,
      };
    }),
  };
}

function linePath(points: LineMark[]): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function areaPath(points: LineMark[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${first.x.toFixed(2)} ${CHART_BASELINE} ${points
    .map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')} L ${last.x.toFixed(2)} ${CHART_BASELINE} Z`;
}

function buildBarLayout(count: number): { width: number; x: (index: number) => number } {
  const span = CHART_RIGHT - CHART_LEFT;
  const gap = count > 20 ? 2 : 4;
  const width = count > 0 ? Math.max(2, (span - gap * Math.max(0, count - 1)) / count) : 0;
  return {
    width,
    x: index => CHART_LEFT + index * (width + gap),
  };
}

function chartInnerHeight(): number {
  return CHART_BASELINE - CHART_TOP;
}

function selectRecord(record: CacheSummaryRecord): void {
  if (!record.snapshotAvailable) return;
  if (!selectedBeforeId.value || selectedBeforeId.value === record.id) {
    void setBefore(record);
    return;
  }
  void setAfter(record);
}

async function setBefore(record: CacheSummaryRecord): Promise<void> {
  if (!record.snapshotAvailable) return;
  selectedBeforeId.value = selectedBeforeId.value === record.id ? null : record.id;
  if (selectedAfterId.value === selectedBeforeId.value) selectedAfterId.value = null;
  if (selectedBeforeId.value) await ensureSnapshot(selectedBeforeId.value);
}

async function setAfter(record: CacheSummaryRecord): Promise<void> {
  if (!record.snapshotAvailable) return;
  selectedAfterId.value = selectedAfterId.value === record.id ? null : record.id;
  if (selectedBeforeId.value === selectedAfterId.value) selectedBeforeId.value = null;
  if (selectedAfterId.value) await ensureSnapshot(selectedAfterId.value);
}

async function loadSelectedSnapshots(beforeId: string | null, afterId: string | null): Promise<void> {
  await Promise.all([beforeId ? ensureSnapshot(beforeId) : Promise.resolve(), afterId ? ensureSnapshot(afterId) : Promise.resolve()]);
}

async function ensureSnapshot(id: string): Promise<void> {
  if (snapshotCache.has(id) || snapshotLoadingIds.has(id)) return;
  snapshotError.value = '';
  snapshotLoadingIds.add(id);
  try {
    snapshotCache.set(id, await getPromptSnapshot(id));
  } catch (error) {
    snapshotError.value = `读取提示词快照失败：${formatError(error)}`;
    snapshotCache.set(id, null);
  } finally {
    snapshotLoadingIds.delete(id);
  }
}

async function toggleFullText(): Promise<void> {
  if (fullText.open) {
    resetFullText();
    return;
  }
  await openFullText(false);
}

async function jumpToBreakpoint(): Promise<void> {
  if (!canShowFullText.value) return;
  await scrollToBreakpoint(fullText.open ? 'full' : 'context');
}

async function openFullText(jumpAfterLoad: boolean): Promise<void> {
  const token = fullText.token + 1;
  const maxLength = Math.max(beforeFullText.value.length, afterFullText.value.length);
  let jumped = false;
  fullText.token = token;
  fullText.open = true;
  fullText.loading = true;
  fullText.beforeLimit = 0;
  fullText.afterLimit = 0;

  for (let offset = CHUNK_SIZE; offset < maxLength + CHUNK_SIZE; offset += CHUNK_SIZE) {
    if (fullText.token !== token) return;
    fullText.beforeLimit = Math.min(beforeFullText.value.length, offset);
    fullText.afterLimit = Math.min(afterFullText.value.length, offset);
    await nextTick();
    if (jumpAfterLoad && !jumped && breakpointLoaded()) {
      await scrollToBreakpoint('full');
      jumped = true;
    }
    if (fullText.beforeLimit >= beforeFullText.value.length && fullText.afterLimit >= afterFullText.value.length) break;
    await nextFrame();
  }

  fullText.loading = false;
  if (jumpAfterLoad && !jumped) await scrollToBreakpoint('full');
}

function breakpointLoaded(): boolean {
  const context = diffResult.value.context;
  if (!context) return false;
  return fullText.beforeLimit >= context.beforeRange.start && fullText.afterLimit >= context.afterRange.start;
}

async function scrollToBreakpoint(target: 'context' | 'full'): Promise<void> {
  await nextTick();
  const ownerDocument = panelElement.value?.ownerDocument ?? document;
  const beforeElement = ownerDocument.getElementById(
    target === 'full' ? fullBreakpointId('before') : contextBreakpointId('before'),
  );
  const afterElement = ownerDocument.getElementById(
    target === 'full' ? fullBreakpointId('after') : contextBreakpointId('after'),
  );
  scrollMarkerToStart(beforeElement);
  scrollMarkerToStart(afterElement);
  (beforeElement ?? afterElement)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function scrollMarkerToStart(element: HTMLElement | null): void {
  if (!element) return;
  const scroller = element.closest('pre');
  if (!(scroller instanceof HTMLElement)) return;
  scroller.scrollTop = Math.max(0, element.offsetTop - scroller.offsetTop - 8);
  scroller.scrollLeft = Math.max(0, element.offsetLeft - scroller.offsetLeft - 8);
}

function resetFullText(): void {
  fullText.token += 1;
  fullText.open = false;
  fullText.loading = false;
  fullText.beforeLimit = 0;
  fullText.afterLimit = 0;
}

function pruneSelection(): void {
  const recordMap = new Map(records.value.map(record => [record.id, record]));
  const before = selectedBeforeId.value ? recordMap.get(selectedBeforeId.value) : null;
  const after = selectedAfterId.value ? recordMap.get(selectedAfterId.value) : null;
  if (selectedBeforeId.value && (!before || !before.snapshotAvailable)) selectedBeforeId.value = null;
  if (selectedAfterId.value && (!after || !after.snapshotAvailable)) selectedAfterId.value = null;
}

function fullMessageText(snapshot: PromptSnapshotRecord | null, index: number | null): string {
  if (!snapshot || index === null) return '';
  return snapshot.messages[index]?.text ?? '';
}

function contextBreakpointId(side: 'before' | 'after'): string {
  return `wbc-context-break-${side}-${selectedBeforeId.value ?? 'a'}-${selectedAfterId.value ?? 'b'}-${diffResult.value.index ?? 'none'}`;
}

function fullBreakpointId(side: 'before' | 'after'): string {
  return `wbc-break-${side}-${selectedBeforeId.value ?? 'a'}-${selectedAfterId.value ?? 'b'}-${diffResult.value.index ?? 'none'}`;
}

function statusLabel(record: CacheSummaryRecord): string {
  if (record.status === 'pending') return '请求中';
  if (record.status === 'failed') return '失败';
  if (!record.snapshotAvailable) return '快照过期';
  return displayErrorMessage(record.errorMessage) ?? '完成';
}

function displayErrorMessage(message: string | null): string | null {
  if (message === '未返回缓存数据') return '无缓存明细';
  return message;
}

function formatRate(record: CacheSummaryRecord | null): string {
  if (!record) return '-';
  if (record.status === 'pending') return '请求中';
  return formatRateValue(record.hitRate);
}

function formatRateValue(value: number | null): string {
  if (value === null) return '未统计';
  return `${(value * 100).toFixed(1)}%`;
}

function rateToneClass(record: CacheSummaryRecord | null): string {
  return rateToneFromValue(record?.hitRate ?? null);
}

function rateToneFromValue(value: number | null): string {
  if (value === null) return 'tone-none';
  if (value >= 0.6) return 'tone-high';
  if (value >= 0.3) return 'tone-mid';
  return 'tone-low';
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function formatTokenLine(record: CacheSummaryRecord): string {
  if (record.totalCacheTokens === 0 && record.outputTokens === 0) return 'token 未统计';
  return `命中 ${formatTokenAmount(record.hitTokens)} / 未 ${formatTokenAmount(record.missTokens)} · 输出 ${formatTokenAmount(record.outputTokens)}`;
}

function recordTokenTooltip(record: CacheSummaryRecord): string {
  const lines = [
    `消息：${formatNumber(record.messageCount)} 条`,
    `提示词：${formatNumber(record.promptChars)} 字`,
    tokenBreakdownTooltip(record),
  ];
  return lines.join('\n');
}

function recordCostLabel(record: CacheSummaryRecord): string {
  if (record.status === 'pending') return '待完成';
  const costSnapshot = priceForRecord(record).costSnapshot;
  if (costSnapshot) return formatCny(costSnapshot.totalCny);
  if (record.totalCacheTokens + record.outputTokens === 0) return '未计费';
  return '费率未匹配';
}

function priceTooltip(record: CacheSummaryRecord): string {
  const pricingSnapshot = priceForRecord(record).pricingSnapshot;
  if (!pricingSnapshot) return '当前模型没有匹配到内置费率规则';
  return `${pricingSnapshot.label} · ${pricingSnapshot.sourceDate} · 按 1 USD = ${pricingSnapshot.usdToCnyRate.toFixed(4)} RMB`;
}

function priceForRecord(record: CacheSummaryRecord): ReturnType<typeof estimateCacheCost> {
  void exchangeRateVersion.value;
  return estimateCacheCost(record.model, record);
}

function formatCny(value: number): string {
  if (!Number.isFinite(value)) return '¥0.000000';
  if (value >= 1) return `¥${value.toFixed(2)}`;
  return `¥${value.toFixed(6)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function formatTokenAmount(value: number): string {
  if (Math.abs(value) < 10_000) return formatNumber(value);
  const unit = Math.abs(value) < 100_000_000 ? '万' : '亿';
  const divisor = Math.abs(value) < 100_000_000 ? 10_000 : 100_000_000;
  return `${trimTrailingZero((value / divisor).toFixed(1))}${unit}`;
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, '');
}

function tokenExactTooltip(label: string, value: number): string {
  return `${label}：${formatNumber(value)} token`;
}

function tokenBreakdownTooltip(value: TokenBreakdown): string {
  return [
    tokenExactTooltip('命中', value.hitTokens),
    tokenExactTooltip('未命中', value.missTokens),
    tokenExactTooltip('输出', value.outputTokens),
  ].join('\n');
}

function formatTokenBreakdown(value: TokenBreakdown | CacheUsageModelSummary): string {
  return `命中 ${formatTokenAmount(value.hitTokens)} / 未 ${formatTokenAmount(value.missTokens)} / 输出 ${formatTokenAmount(value.outputTokens)}`;
}

function tokenChartMarkLabel(bucketLabel: string, segmentLabel: string, value: number): string {
  const displayValue = formatTokenAmount(value);
  const exactValue = formatNumber(value);
  if (displayValue === exactValue) return `${bucketLabel} · ${segmentLabel} ${exactValue} token`;
  return `${bucketLabel} · ${segmentLabel} ${displayValue}（${exactValue} token）`;
}

function changedTextLabel(text: string, fullLength: number): string {
  if (fullLength === 0 && text.length === 0) return '∅';
  if (fullLength <= text.length) return text;
  return `${text}…`;
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
</script>

<style scoped>
.wbc-panel {
  display: grid;
  gap: 12px;
  padding: 12px;
  color: var(--wbm-text);
}

.wbc-overview {
  display: grid;
  grid-template-columns: repeat(6, minmax(150px, 1fr));
  gap: 10px;
}

.wbc-metric,
.wbc-records,
.wbc-diff {
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-lg);
  background: #17181b;
}

.wbc-metric {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 11px 12px;
}

.wbc-metric span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbc-metric span,
.wbc-metric small,
.wbc-section-head span,
.wbc-record-text small,
.wbc-full-head span {
  color: var(--wbm-muted);
}

.wbc-metric strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 21px;
  line-height: 1.12;
}

.wbc-metric small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbc-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 46px;
}

.wbc-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
  color: var(--wbm-muted);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.wbc-field span {
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  line-height: 1;
}

.wbc-field select,
.wbc-field input {
  box-sizing: border-box;
  height: 34px;
  width: 150px;
  min-width: 0;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  padding: 0 10px;
  background: #111113;
  color: var(--wbm-text);
  font: inherit;
}

.wbc-field-number {
  min-width: 124px;
}

.wbc-field-number input {
  width: 72px;
}

.wbc-layout {
  display: grid;
  grid-template-columns: minmax(420px, 0.92fr) minmax(0, 1.38fr);
  gap: 12px;
  align-items: start;
}

.wbc-records,
.wbc-diff {
  min-width: 0;
  overflow: hidden;
}

.wbc-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 54px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--wbm-border-soft);
  background: #232429;
}

.wbc-section-head h3,
.wbc-diff-side h4 {
  margin: 0;
}

.wbc-section-head h3 {
  flex: 0 0 auto;
  white-space: nowrap;
}

.wbc-record-header-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
}

.wbc-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.wbc-record-list {
  display: grid;
  max-height: min(620px, calc(var(--wbm-vvh, 100dvh) - 314px));
  overflow: auto;
}

.wbc-record {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px;
  align-items: stretch;
  border-bottom: 1px solid var(--wbm-border-soft);
}

.wbc-record.is-before {
  box-shadow: inset 3px 0 0 var(--wbm-blue-strong);
}

.wbc-record.is-after {
  box-shadow: inset 3px 0 0 #4ade80;
}

.wbc-record.is-stats-only {
  background: rgba(255, 255, 255, 0.018);
}

.wbc-record.is-pending {
  background:
    linear-gradient(90deg, rgba(77, 107, 254, 0), rgba(77, 107, 254, 0.07), rgba(77, 107, 254, 0))
      0 0 / 220% 100%,
    rgba(77, 107, 254, 0.028);
  animation: wbc-pending-sweep 1.4s ease-in-out infinite;
}

.wbc-record-main {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) minmax(82px, auto) 82px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 9px 10px;
  border: 0;
  background: transparent;
  color: var(--wbm-text);
  text-align: left;
  cursor: pointer;
}

.wbc-record-main:hover {
  background: rgba(255, 255, 255, 0.04);
}

.wbc-record-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.wbc-record-text strong,
.wbc-record-text small,
.wbc-cost {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbc-rate,
.wbc-status,
.wbc-choice-btn,
.wbc-cost {
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: var(--wbm-radius-md);
  background: rgba(255, 255, 255, 0.04);
}

.wbc-rate,
.wbc-status,
.wbc-cost {
  padding: 4px 7px;
  font-weight: 800;
  text-align: center;
}

.wbc-rate {
  font-variant-numeric: tabular-nums;
}

.wbc-status,
.wbc-cost {
  color: var(--wbm-muted);
  font-size: 12px;
}

.wbc-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  box-sizing: border-box;
  min-width: 72px;
  min-height: 28px;
  white-space: nowrap;
}

.wbc-status .fa-spin {
  flex: 0 0 auto;
  font-size: 11px;
}

.wbc-status.status-failed {
  border-color: rgba(248, 113, 113, 0.52);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.2);
}

.wbc-status.status-pending {
  border-color: rgba(95, 130, 255, 0.52);
  color: #dbe5ff;
  background: var(--wbm-blue-soft);
}

@keyframes wbc-pending-sweep {
  0% {
    background-position: 110% 0, 0 0;
  }

  100% {
    background-position: -110% 0, 0 0;
  }
}

.wbc-record-actions {
  display: grid;
  grid-template-columns: repeat(2, 36px);
  gap: 6px;
  align-items: center;
  justify-content: end;
  padding: 8px 10px 8px 0;
}

.wbc-choice-btn {
  width: 36px;
  height: 36px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  color: var(--wbm-muted);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-style: normal;
  font-weight: 900;
  line-height: 1;
  text-align: center;
}

.wbc-choice-btn.active {
  border-color: var(--wbm-blue-strong);
  color: #fff;
  background: var(--wbm-blue);
}

.wbc-choice-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.wbc-diff-body {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.wbc-diff-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(77, 107, 254, 0.34);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-blue-softer);
}

.wbc-diff-summary.kind-same {
  border-color: rgba(74, 222, 128, 0.38);
  background: rgba(22, 101, 52, 0.18);
}

.wbc-diff-summary span {
  color: var(--wbm-muted);
  font-weight: 700;
}

.wbc-diff-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.wbc-diff-side {
  min-width: 0;
}

.wbc-diff-side h4 {
  padding: 0 0 6px;
  color: var(--wbm-muted);
}

.wbc-diff-side pre {
  min-height: 220px;
  max-height: min(520px, calc(var(--wbm-vvh, 100dvh) - 390px));
  margin: 0;
  overflow: auto;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: #111113;
  color: var(--wbm-text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  font: inherit;
}

.wbc-context {
  color: var(--wbm-muted);
}

.wbc-del,
.wbc-ins {
  border-radius: 4px;
  padding: 0 2px;
  color: inherit;
}

.wbc-del {
  background: rgba(248, 113, 113, 0.32);
  box-shadow: inset 0 -1px 0 rgba(248, 113, 113, 0.9);
}

.wbc-ins {
  background: rgba(74, 222, 128, 0.25);
  box-shadow: inset 0 -1px 0 rgba(74, 222, 128, 0.78);
}

.wbc-loading-tail {
  color: var(--wbm-muted);
}

.wbc-empty-state {
  min-height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--wbm-muted);
}

.wbc-empty-state.compact {
  min-height: 180px;
}

.wbc-full-text {
  display: grid;
  gap: 8px;
}

.wbc-full-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tone-high {
  border-color: rgba(74, 222, 128, 0.56);
  color: #bbf7d0;
  background: rgba(22, 101, 52, 0.24);
}

.tone-mid {
  border-color: rgba(251, 191, 36, 0.58);
  color: #fde68a;
  background: rgba(113, 63, 18, 0.24);
}

.tone-low {
  border-color: rgba(248, 113, 113, 0.56);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.22);
}

.tone-none {
  color: var(--wbm-muted);
}

.wbm-small-btn,
.wbm-danger-btn {
  border: 1px solid var(--wbm-border);
  border-radius: 999px;
  padding: 7px 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--wbm-text);
  cursor: pointer;
  flex: 0 0 auto;
  background: var(--wbm-surface-raised);
  line-height: 1.3;
  white-space: nowrap;
}

.wbm-danger-btn {
  border-color: #ef4444;
  background: #b91c1c;
  color: #fff;
}

.wbm-small-btn:hover:not(:disabled),
.wbm-danger-btn:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.wbm-small-btn:disabled,
.wbm-danger-btn:disabled {
  cursor: not-allowed;
  border-color: var(--wbm-border);
  background: #25262a;
  color: #9da3b3;
}

.wbm-alert,
.wbm-empty {
  color: var(--wbm-muted);
}

.wbm-alert {
  padding: 10px 12px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: rgba(255, 255, 255, 0.04);
}

.wbm-alert-error {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.16);
}

.wbm-empty {
  padding: 28px 12px;
  text-align: center;
}

.wbc-modal {
  position: absolute;
  top: 0;
  left: 0;
  z-index: var(--wbm-z-modal, 31400);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 16px;
  background: rgba(0, 0, 0, 0.66);
  backdrop-filter: blur(10px);
}

.wbc-modal-box {
  width: min(420px, 100%);
  max-height: calc(var(--wbm-vvh, 100dvh) - 32px);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-lg);
  padding: 16px;
  background: var(--wbm-surface, #17181b);
  color: var(--wbm-text);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}

.wbc-confirm-box {
  display: grid;
  gap: 12px;
}

.wbc-confirm-box h3,
.wbc-confirm-box p,
.wbc-modal-head h3,
.wbc-modal-head p,
.wbc-chart-card h4,
.wbc-model-summary h4 {
  margin: 0;
}

.wbc-confirm-box p,
.wbc-modal-head p,
.wbc-chart-card header span,
.wbc-model-summary header span {
  color: var(--wbm-muted);
}

.wbc-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.wbc-usage-box {
  width: min(1120px, calc(100vw - 32px));
  display: grid;
  gap: 12px;
}

.wbc-modal-head,
.wbc-chart-card header,
.wbc-model-summary header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.wbc-modal-head p {
  margin-top: 4px;
  max-width: 820px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbc-modal-close {
  width: 34px;
  height: 34px;
  border: 1px solid var(--wbm-border);
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  cursor: pointer;
}

.wbc-usage-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.wbc-usage-summary article,
.wbc-chart-card,
.wbc-model-summary {
  min-width: 0;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: #17181b;
}

.wbc-usage-summary article {
  display: grid;
  gap: 4px;
  padding: 10px;
}

.wbc-usage-summary span,
.wbc-usage-summary small {
  color: var(--wbm-muted);
}

.wbc-usage-summary strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 20px;
  line-height: 1.12;
}

.wbc-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.wbc-chart-card {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.wbc-chart-card header h4,
.wbc-model-summary h4 {
  font-size: 14px;
}

.wbc-chart-svg {
  width: 100%;
  height: 168px;
  display: block;
  overflow: visible;
}

.wbc-axis-line {
  stroke: rgba(148, 163, 184, 0.28);
  stroke-width: 1;
}

.wbc-bar-cost {
  fill: #f59e0b;
}

.wbc-bar-saving,
.wbc-bar-hit {
  fill: #22c55e;
}

.wbc-bar-miss {
  fill: #ef4444;
}

.wbc-bar-output {
  fill: #60a5fa;
}

.wbc-line-area {
  fill: rgba(59, 130, 246, 0.18);
}

.wbc-line-path {
  fill: none;
  stroke: #3b82f6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3;
}

.wbc-line-point {
  fill: #bfdbfe;
  stroke: #1d4ed8;
  stroke-width: 1.5;
}

.wbc-chart-axis,
.wbc-chart-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--wbm-muted);
  font-size: 12px;
}

.wbc-chart-legend {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.wbc-chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.wbc-chart-legend i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
}

.legend-hit {
  background: #22c55e;
}

.legend-miss {
  background: #ef4444;
}

.legend-output {
  background: #60a5fa;
}

.wbc-model-summary {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.wbc-model-list {
  display: grid;
  gap: 6px;
}

.wbc-model-row {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) 70px 110px 88px;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--wbm-border-soft);
  border-radius: var(--wbm-radius-sm);
  background: rgba(255, 255, 255, 0.03);
}

.wbc-model-row strong,
.wbc-model-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbc-model-row span {
  color: var(--wbm-muted);
  text-align: right;
}

@media (max-width: 1280px) {
  .wbc-overview {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .wbc-overview,
  .wbc-layout,
  .wbc-diff-grid {
    grid-template-columns: 1fr;
  }

  .wbc-record {
    grid-template-columns: minmax(0, 1fr) 84px;
  }

  .wbc-record-main {
    grid-template-columns: 82px minmax(0, 1fr);
  }

  .wbc-cost,
  .wbc-status {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (max-width: 760px) {
  .wbc-panel {
    gap: 8px;
    padding: 8px;
  }

  .wbc-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .wbc-metric {
    min-height: 58px;
    gap: 2px;
    padding: 8px 9px;
    border-radius: var(--wbm-radius-md);
  }

  .wbc-metric span,
  .wbc-metric small {
    font-size: 11px;
    line-height: 1.2;
  }

  .wbc-metric strong {
    font-size: 16px;
    line-height: 1.1;
  }

  .wbc-toolbar {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
    align-items: end;
  }

  .wbc-field,
  .wbc-field-number {
    display: grid;
    gap: 3px;
    width: auto;
    min-width: 0;
    font-size: 11px;
  }

  .wbc-field select,
  .wbc-field input {
    width: 100%;
    height: 32px;
    padding: 0 9px;
    border-radius: 12px;
    font-size: 13px;
  }

  .wbc-layout {
    gap: 8px;
  }

  .wbc-records,
  .wbc-diff {
    border-radius: var(--wbm-radius-md);
  }

  .wbc-section-head {
    min-height: 42px;
    padding: 7px 9px;
  }

  .wbc-record-header-actions {
    gap: 6px;
  }

  .wbc-record-header-actions .wbm-small-btn,
  .wbc-record-header-actions .wbm-danger-btn {
    min-height: 32px;
    padding: 5px 9px;
    border-radius: 12px;
    font-size: 12px;
  }

  .wbc-section-head h3 {
    font-size: 15px;
  }

  .wbc-section-head span {
    font-size: 12px;
  }

  .wbc-record-list {
    max-height: min(520px, calc(var(--wbm-vvh, 100dvh) - 256px));
  }

  .wbc-record {
    grid-template-columns: minmax(0, 1fr) 68px;
    min-height: 68px;
  }

  .wbc-record-main {
    grid-template-columns: 62px minmax(0, 1fr) 68px;
    grid-template-rows: auto auto;
    gap: 2px 7px;
    min-height: 68px;
    padding: 7px 7px 7px 9px;
  }

  .wbc-rate {
    grid-column: 1;
    grid-row: 1 / 3;
    align-self: center;
    padding: 4px 5px;
    border-radius: 999px;
    font-size: 13px;
    line-height: 1.15;
  }

  .wbc-record-text {
    grid-column: 2;
    grid-row: 1 / 3;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    gap: 1px 6px;
    align-self: center;
    align-items: baseline;
  }

  .wbc-record-text strong {
    grid-column: 1;
    grid-row: 1;
    font-size: 14px;
    line-height: 1.18;
  }

  .wbc-record-text small {
    font-size: 12px;
    line-height: 1.25;
  }

  .wbc-record-text small:nth-of-type(1) {
    grid-column: 2;
    grid-row: 1;
  }

  .wbc-record-text small:nth-of-type(2) {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .wbc-cost {
    grid-column: 3;
    grid-row: 1;
    align-self: end;
    justify-self: stretch;
    max-width: 100%;
    padding: 3px 5px;
    border-radius: 999px;
    font-size: 10px;
    line-height: 1.15;
  }

  .wbc-status {
    display: none;
    grid-column: 3;
    grid-row: 2;
    align-self: start;
    justify-self: stretch;
    min-width: 0;
    padding: 3px 5px;
    border-radius: 999px;
    font-size: 10px;
    line-height: 1.15;
  }

  .wbc-status.status-pending,
  .wbc-status.status-failed {
    display: inline-flex;
  }

  .wbc-record-actions {
    grid-template-columns: repeat(2, 30px);
    gap: 5px;
    justify-content: center;
    padding: 0 6px 0 0;
  }

  .wbc-choice-btn {
    width: 30px;
    height: 30px;
    border-radius: 12px;
    font-size: 12px;
  }

  .wbc-diff-body {
    gap: 8px;
    padding: 9px;
  }

  .wbc-diff-summary {
    display: grid;
    gap: 4px;
    padding: 8px;
    font-size: 13px;
  }

  .wbc-head-actions {
    gap: 6px;
  }

  .wbc-head-actions .wbm-small-btn {
    min-height: 32px;
    padding: 5px 9px;
    font-size: 12px;
  }

  .wbc-diff-side pre {
    min-height: 180px;
    max-height: min(420px, calc(var(--wbm-vvh, 100dvh) - 300px));
    padding: 8px;
    font-size: 13px;
  }

  .wbc-modal {
    padding: 8px;
  }

  .wbc-modal-box {
    max-height: calc(var(--wbm-vvh, 100dvh) - 16px);
    padding: 10px;
    border-radius: var(--wbm-radius-md);
  }

  .wbc-usage-box {
    width: 100%;
    gap: 8px;
  }

  .wbc-usage-modal .wbc-usage-box {
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .wbc-modal-head {
    align-items: center;
    gap: 8px;
  }

  .wbc-modal-head h3 {
    font-size: 16px;
    line-height: 1.2;
  }

  .wbc-modal-head p {
    max-width: calc(100vw - 88px);
    font-size: 11px;
  }

  .wbc-modal-close {
    width: 32px;
    height: 32px;
  }

  .wbc-usage-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .wbc-usage-summary article {
    min-height: 54px;
    gap: 2px;
    padding: 7px 8px;
  }

  .wbc-usage-summary span,
  .wbc-usage-summary small {
    font-size: 11px;
    line-height: 1.2;
  }

  .wbc-usage-summary strong {
    font-size: 15px;
  }

  .wbc-chart-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .wbc-chart-card,
  .wbc-model-summary {
    padding: 8px;
    border-radius: 12px;
  }

  .wbc-chart-card {
    gap: 5px;
  }

  .wbc-chart-card header h4,
  .wbc-model-summary h4 {
    font-size: 12px;
  }

  .wbc-chart-card header span,
  .wbc-model-summary header span,
  .wbc-chart-axis,
  .wbc-chart-legend {
    font-size: 10px;
  }

  .wbc-chart-svg {
    height: 124px;
  }

  .wbc-model-list {
    gap: 5px;
  }

  .wbc-model-row {
    grid-template-columns: minmax(0, 1fr) 42px 72px 72px;
    gap: 5px;
    padding: 6px 7px;
    font-size: 11px;
  }

  .wbc-confirm-box {
    align-self: center;
  }

  .wbc-dialog-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
