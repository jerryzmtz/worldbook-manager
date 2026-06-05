<template>
  <div v-if="isOpen" ref="managerRootElement" class="wbm-overlay" @click.self="closeManager">
    <section
      class="wbm-dialog"
      :class="{ 'cache-mode': activePanel === 'cacheInspector' }"
      role="dialog"
      aria-modal="true"
      :aria-label="activePanelTitle"
    >
      <header class="wbm-header">
        <div>
          <div class="wbm-title-line">
            <h2>{{ activePanelTitle }}</h2>
            <span class="wbm-version">{{ APP_VERSION }}</span>
          </div>
        </div>
        <div class="wbm-header-actions">
          <button
            class="wbm-icon-btn wbm-version-manager-btn"
            :class="{ checking: versionCheckRunning, available: versionUpdateAvailable }"
            type="button"
            :title="versionManagerButtonTitle"
            :aria-label="versionManagerButtonTitle"
            data-wbm-tutorial="version-manager"
            @click="openVersionManager"
          >
            <i class="fa-solid" :class="versionManagerButtonIcon"></i>
            <span v-if="versionUpdateAvailable" class="wbm-update-dot" aria-hidden="true"></span>
          </button>
          <button
            v-if="activePanel === 'optimizer'"
            class="wbm-icon-btn"
            type="button"
            title="优化设置"
            aria-label="优化设置"
            :disabled="isBusy"
            data-wbm-tutorial="optimizer-settings"
            @click="openOptimizerSettings"
          >
            <i class="fa-solid fa-gear"></i>
          </button>
          <button
            v-if="activePanel === 'optimizer' || activePanel === 'cacheInspector'"
            class="wbm-icon-btn wbm-tutorial-trigger"
            type="button"
            :title="activePanel === 'cacheInspector' ? '播放缓存命中对比教程' : '播放教程'"
            :aria-label="activePanel === 'cacheInspector' ? '播放缓存命中对比教程' : '播放教程'"
            data-wbm-tutorial-trigger
            :disabled="activePanel !== 'cacheInspector' && isBusy"
            @click="startTutorial"
          >
            <i class="fa-solid fa-circle-question"></i>
          </button>
          <button
            class="wbm-icon-btn"
            type="button"
            title="关闭"
            :disabled="activePanel !== 'cacheInspector' && isBusy"
            @click="closeManager"
          >
            <i class="fa-solid fa-times"></i>
          </button>
        </div>
      </header>

      <div v-if="activePanel === 'optimizer' && !apiReady" class="wbm-alert wbm-alert-error">
        世界书 API 不可用，无法读取或修改世界书。
      </div>

      <div v-if="activePanel === 'dedupe' && !dedupeApiReady" class="wbm-alert wbm-alert-error">
        世界书去重 API 不可用，无法读取或删除世界书。
      </div>

      <CacheInspectorPanel v-if="activePanel === 'cacheInspector'" />

      <section v-if="activePanel === 'dedupe'" class="wbm-work-section wbm-dedupe-section">
        <div class="wbm-section-toolbar">
          <div>
            <h3>去重配置</h3>
            <span>规则策略 · 世界书选择 · 应用确认</span>
          </div>
          <button class="wbm-small-btn" type="button" :disabled="isBusy || !dedupeApiReady" @click="loadWorldbooksForDedupe">
            <i class="fa-solid fa-rotate"></i>
            刷新
          </button>
        </div>

        <main class="wbm-body wbm-dedupe-body" :aria-busy="isBusy">
          <section class="wbm-panel wbm-books-panel">
            <div class="wbm-panel-title">
              <h3>世界书</h3>
              <span class="wbm-inline-stat">{{ selectedBooks.size }}/{{ worldbookNames.length }} 本</span>
            </div>

            <input
              v-model="bookFilter"
              class="wbm-input"
              type="search"
              placeholder="搜索世界书"
              :disabled="isBusy || !dedupeApiReady"
            />

            <div class="wbm-book-controls">
              <label>
                来源
                <select v-model="bookSourceFilter" class="wbm-select" :disabled="isBusy || !dedupeApiReady">
                  <option value="all">全部来源</option>
                  <option value="active">当前启用</option>
                  <option value="chat">聊天</option>
                  <option value="character">角色 / 附加</option>
                  <option value="global">全局</option>
                  <option value="none">未绑定</option>
                </select>
              </label>
              <label>
                排序
                <select
                  :value="bookSortMode"
                  class="wbm-select"
                  :disabled="isBusy || !dedupeApiReady"
                  @click="handleBookSortClick"
                  @change="handleBookSortChange"
                >
                  <option value="default">默认</option>
                  <option value="selected">已选择</option>
                  <option value="name_asc">名称 A 到 Z</option>
                  <option value="name_desc">名称 Z 到 A</option>
                  <option value="source">来源</option>
                  <option value="entry_desc">条目数 ↓</option>
                  <option value="token_desc">Token≈ ↓</option>
                  <option value="dynamic_desc">动态内容 ↓</option>
                </select>
              </label>
            </div>

            <div
              v-if="metadataProgress.total > 0 && metadataProgress.loaded < metadataProgress.total"
              class="wbm-loading-line"
            >
              <i class="fa-solid fa-circle-notch fa-spin"></i>
              正在计算世界书信息 {{ metadataProgress.loaded }}/{{ metadataProgress.total }}
            </div>

            <div class="wbm-row-actions">
              <button class="wbm-small-btn" type="button" :disabled="isBusy || !dedupeApiReady" @click="selectActiveBooks">
                自动选择
              </button>
              <button
                class="wbm-small-btn"
                type="button"
                :disabled="isBusy || filteredWorldbookNames.length === 0"
                @click="selectFilteredBooks"
              >
                全选
              </button>
              <button
                class="wbm-small-btn"
                type="button"
                :disabled="isBusy || selectedBooks.size === 0"
                @click="clearSelectedBooks"
              >
                清空
              </button>
            </div>

            <div class="wbm-book-list">
              <label
                v-for="name in filteredWorldbookNames"
                :key="`dedupe:${name}`"
                class="wbm-check-row"
                :class="{ selected: selectedBooks.has(name), 'active-source': bookSourceBadges(name).length > 0 }"
                :title="name"
              >
                <input
                  type="checkbox"
                  :checked="selectedBooks.has(name)"
                  :disabled="isBusy"
                  @change="toggleBook(name)"
                />
                <span class="wbm-book-name">{{ name }}</span>
                <span
                  v-for="source in bookSourceBadges(name)"
                  :key="`dedupe:${name}:${source.value}`"
                  class="wbm-source-badge"
                  :class="`source-${source.value}`"
                  :title="source.title"
                  aria-label="世界书来源"
                >
                  {{ source.label }}
                </span>
                <span class="wbm-book-meta">{{ bookMetadataLabel(name) }}</span>
              </label>
              <div v-if="filteredWorldbookNames.length === 0" class="wbm-empty">没有匹配的世界书。</div>
            </div>
          </section>

          <section class="wbm-panel wbm-rules-panel wbm-dedupe-rule-panel">
            <div class="wbm-panel-title">
              <h3>规则区</h3>
              <span class="wbm-inline-stat">{{ currentDedupeStrategyOption.label }} · 最新版本优先</span>
            </div>
            <div class="wbm-preset wbm-dedupe-preset">
              <div class="wbm-mode-switch wbm-dedupe-strategy-switch" aria-label="世界书去重策略">
                <button
                  v-for="option in DEDUPE_STRATEGY_OPTIONS"
                  :key="option.value"
                  class="wbm-mode-option"
                  :class="{ active: dedupeStrategy === option.value }"
                  type="button"
                  :aria-pressed="dedupeStrategy === option.value"
                  :disabled="isBusy"
                  @click="setDedupeStrategy(option.value)"
                  >
                    <i class="fa-solid" :class="option.icon"></i>
                    <span>
                      <strong>{{ option.label }}</strong>
                    </span>
                  </button>
                </div>
              <div class="wbm-dedupe-rules">
                <div v-for="rule in currentDedupeRuleDetails" :key="rule.title">
                  <strong>{{ rule.title }}</strong>
                  <span>{{ rule.description }}</span>
                </div>
              </div>
            </div>
          </section>
        </main>
      </section>

      <section v-if="activePanel === 'dedupe'" class="wbm-work-section wbm-preview-shell wbm-dedupe-preview-shell">
        <div class="wbm-section-toolbar">
          <div>
            <h3>去重方案</h3>
            <span>{{ dedupeSummaryLabel }}</span>
          </div>
        </div>

        <section class="wbm-preview wbm-dedupe-preview">
          <div class="wbm-preview-actions wbm-dedupe-actions">
            <button
              class="wbm-primary-btn wbm-generate-action"
              type="button"
              :disabled="isBusy || !canGenerateDedupePreview"
              @click="generateDedupePreview"
            >
              <i class="fa-solid fa-magnifying-glass"></i>
              生成方案
            </button>
            <button
              class="wbm-primary-btn wbm-apply-action"
              type="button"
              :disabled="isBusy || !canApplyDedupe"
              @click="confirmDedupeApply"
            >
              <i class="fa-solid fa-trash-can"></i>
              应用去重
            </button>
            <div class="wbm-filter-stats" aria-live="polite">{{ dedupeSelectionLabel }}</div>
          </div>

          <div v-if="dedupeApplyResults.length > 0" class="wbm-apply-results wbm-dedupe-results">
            <span
              v-for="result in dedupeApplyResults"
              :key="`${result.groupId}:${result.worldbook}`"
              :class="{ failed: result.failed }"
            >
              {{ result.worldbook }}:
              {{ result.failed ? result.errorMessage : `已删除，保留 ${result.keepName}` }}
            </span>
          </div>

          <div class="wbm-dedupe-group-list">
            <article
              v-for="group in dedupeGroups"
              :key="group.id"
              class="wbm-dedupe-group"
              :class="{
                selected: isDedupeGroupSelected(group.id),
                skipped: !isDedupeGroupSelected(group.id),
                low: group.confidence === 'low',
              }"
            >
              <div class="wbm-dedupe-group-head">
                <label class="wbm-dedupe-group-check">
                  <input
                    type="checkbox"
                    :checked="isDedupeGroupSelected(group.id)"
                    :disabled="isBusy"
                    @change="toggleDedupeGroup(group.id)"
                  />
                  <span>
                    <strong>{{ group.familyName }}</strong>
                    <small>{{ group.reason }}</small>
                  </span>
                </label>
                <span class="wbm-dedupe-confidence" :class="`confidence-${group.confidence}`">
                  {{ dedupeConfidenceLabel(group.confidence) }}
                </span>
              </div>

              <div class="wbm-dedupe-keep-row">
                <label>
                  保留
                  <select
                    class="wbm-select"
                    :value="dedupeKeepName(group)"
                    :disabled="isBusy"
                    @change="setDedupeKeepCandidate(group, $event)"
                  >
                    <option v-for="candidate in group.candidates" :key="candidate.name" :value="candidate.name">
                      {{ candidate.name }}
                    </option>
                  </select>
                </label>
                <span>{{ dedupeDeleteSummary(group) }}</span>
              </div>

              <div v-if="group.warnings.length > 0" class="wbm-dedupe-warning-line">
                <i class="fa-solid fa-triangle-exclamation"></i>
                {{ group.warnings.join('；') }}
              </div>
              <div v-if="dedupeGroupCharacterRebindCount(group) > 0" class="wbm-dedupe-warning-line">
                <i class="fa-solid fa-link"></i>
                将更新 {{ dedupeGroupCharacterRebindCount(group) }} 张角色卡的主世界书绑定
              </div>

              <div class="wbm-dedupe-candidates">
                <div
                  v-for="candidate in group.candidates"
                  :key="candidate.name"
                  class="wbm-dedupe-candidate"
                  :class="{ keep: candidate.name === dedupeKeepName(group), remove: candidate.name !== dedupeKeepName(group) }"
                >
                  <div>
                    <strong>{{ candidate.name }}</strong>
                    <span>{{ dedupeCandidateVersionLabel(candidate) }}</span>
                  </div>
                  <p>{{ dedupeCandidateMeta(candidate) }}</p>
                  <small>{{ dedupeCandidateSimilarityLabel(group, candidate) }}</small>
                </div>
              </div>
            </article>
            <div v-if="dedupeGroups.length === 0" class="wbm-empty">{{ dedupeEmptyText }}</div>
          </div>
        </section>
      </section>

      <section
        v-if="activePanel === 'optimizer'"
        class="wbm-work-section wbm-setup-section"
        :class="{ collapsed: isSetupCollapsed, expanded: isPreviewCollapsed && !isSetupCollapsed }"
      >
        <div class="wbm-section-toolbar">
          <div>
            <h3>配置区</h3>
            <span>世界书选择 · 优化模式 · 应用提醒</span>
          </div>
          <button
            class="wbm-small-btn"
            type="button"
            :title="isSetupCollapsed ? '展开配置区' : '收起配置区'"
            @click="isSetupCollapsed = !isSetupCollapsed"
          >
            <i class="fa-solid" :class="isSetupCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
            {{ isSetupCollapsed ? '展开' : '收起' }}
          </button>
        </div>

        <main v-show="!isSetupCollapsed" class="wbm-body" :aria-busy="isBusy">
          <section class="wbm-panel wbm-books-panel">
            <div class="wbm-panel-title">
              <h3>世界书</h3>
              <button class="wbm-small-btn" type="button" :disabled="isBusy || !apiReady" @click="loadWorldbooks">
                <i class="fa-solid fa-rotate"></i>
                刷新
              </button>
            </div>

            <input
              v-model="bookFilter"
              class="wbm-input"
              type="search"
              placeholder="搜索世界书"
              :disabled="isBusy || !apiReady"
            />

            <div class="wbm-book-controls">
              <label>
                来源
                <select v-model="bookSourceFilter" class="wbm-select" :disabled="isBusy || !apiReady">
                  <option value="all">全部来源</option>
                  <option value="active">当前启用</option>
                  <option value="chat">聊天</option>
                  <option value="character">角色 / 附加</option>
                  <option value="global">全局</option>
                  <option value="none">未绑定</option>
                </select>
              </label>
              <label>
                排序
                <select
                  :value="bookSortMode"
                  class="wbm-select"
                  :disabled="isBusy || !apiReady"
                  @click="handleBookSortClick"
                  @change="handleBookSortChange"
                >
                  <option value="default">默认</option>
                  <option value="selected">已选择</option>
                  <option value="name_asc">名称 A 到 Z</option>
                  <option value="name_desc">名称 Z 到 A</option>
                  <option value="source">来源</option>
                  <option value="entry_desc">条目数 ↓</option>
                  <option value="token_desc">Token≈ ↓</option>
                  <option value="dynamic_desc">动态内容 ↓</option>
                </select>
              </label>
            </div>

            <div
              v-if="metadataProgress.total > 0 && metadataProgress.loaded < metadataProgress.total"
              class="wbm-loading-line"
            >
              <i class="fa-solid fa-circle-notch fa-spin"></i>
              正在计算世界书信息 {{ metadataProgress.loaded }}/{{ metadataProgress.total }}
            </div>

            <div class="wbm-row-actions">
              <button
                class="wbm-small-btn"
                type="button"
                :disabled="isBusy || !apiReady"
                @click="selectDefaultOptimizerBooks"
              >
                自动选择
              </button>
              <button
                class="wbm-small-btn"
                type="button"
                :disabled="isBusy || filteredWorldbookNames.length === 0"
                @click="selectFilteredBooks"
              >
                全选
              </button>
              <button
                class="wbm-small-btn"
                type="button"
                :disabled="isBusy || selectedBooks.size === 0"
                @click="clearSelectedBooks"
              >
                清空
              </button>
            </div>

            <div ref="bookListElement" class="wbm-book-list">
              <label
                v-for="name in filteredWorldbookNames"
                :key="name"
                class="wbm-check-row"
                :class="{ selected: selectedBooks.has(name), 'active-source': bookSourceBadges(name).length > 0 }"
                :title="name"
              >
                <input
                  type="checkbox"
                  :checked="selectedBooks.has(name)"
                  :disabled="isBusy"
                  @change="toggleBook(name)"
                />
                <span class="wbm-book-name">{{ name }}</span>
                <span
                  v-for="source in bookSourceBadges(name)"
                  :key="`${name}:${source.value}`"
                  class="wbm-source-badge"
                  :class="`source-${source.value}`"
                  :title="source.title"
                  aria-label="世界书来源"
                >
                  {{ source.label }}
                </span>
                <span class="wbm-book-meta">{{ bookMetadataLabel(name) }}</span>
              </label>
              <div v-if="filteredWorldbookNames.length === 0" class="wbm-empty">没有匹配的世界书。</div>
            </div>
          </section>

          <section class="wbm-panel wbm-rules-panel">
            <div class="wbm-panel-title">
              <h3>规则区</h3>
              <button
                class="wbm-small-btn"
                type="button"
                :title="`查看${currentModeOption.label}说明`"
                :aria-label="`查看${currentModeOption.label}说明`"
                @click="openRuleHelp"
              >
                <i class="fa-solid fa-question"></i>
                说明
              </button>
            </div>

            <div class="wbm-preset">
              <div class="wbm-mode-switch" aria-label="选择优化模式">
                <button
                  v-for="option in OPTIMIZER_MODE_OPTIONS"
                  :key="option.value"
                  class="wbm-mode-option"
                  :class="{ active: optimizerMode === option.value }"
                  type="button"
                  :aria-pressed="optimizerMode === option.value"
                  :disabled="isBusy"
                  @click="setOptimizerMode(option.value)"
                >
                  <i class="fa-solid" :class="option.icon"></i>
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.subtitle }}</small>
                  </span>
                </button>
              </div>

              <div class="wbm-rule-map" :aria-label="`${currentModeOption.label}规则结构图`">
                <div class="wbm-rule-map-title">
                  <span>{{ ruleMapBeforeLabel }}</span>
                  <span>{{ ruleMapAfterLabel }}</span>
                </div>
                <div v-for="flow in activeRuleFlowRows" :key="flow.id" class="wbm-rule-flow-row">
                  <div class="wbm-flow-node" :class="`tone-${flow.fromTone}`">
                    <span class="wbm-action-dot" aria-hidden="true"></span>
                    <strong :style="ruleFlowLabelStyle(flow.from)">{{ flow.from }}</strong>
                  </div>
                  <div class="wbm-flow-arrow">
                    <i class="fa-solid fa-arrow-right"></i>
                  </div>
                  <div class="wbm-flow-node" :class="`tone-${flow.toTone}`">
                    <span class="wbm-action-dot" aria-hidden="true"></span>
                    <strong :style="ruleFlowLabelStyle(flow.to)">{{ flow.to }}</strong>
                  </div>
                </div>
              </div>
              <p class="wbm-scope-note">
                {{
                  optimizerMode === 'cache'
                    ? '摘要、总结插件、数据库和隐藏消息用正则不属于世界书，需要在对应管理界面里进行单独处理。'
                    : '合并只在每本世界书内部执行；同一批选中的世界书会一起生成意见，但不会跨书写入。'
                }}
              </p>
            </div>

            <div v-if="validationMessage" class="wbm-alert">{{ validationMessage }}</div>
          </section>
        </main>
      </section>

      <section
        v-if="activePanel === 'optimizer'"
        class="wbm-work-section wbm-preview-shell"
        :class="{ collapsed: isPreviewCollapsed, expanded: isSetupCollapsed && !isPreviewCollapsed }"
      >
        <div class="wbm-section-toolbar">
          <div>
            <h3>{{ previewSectionTitle }}</h3>
            <span>{{ previewSectionSummary }}</span>
          </div>
          <button
            class="wbm-small-btn"
            type="button"
            :title="`${isPreviewCollapsed ? '展开' : '收起'}${previewSectionTitle}`"
            @click="isPreviewCollapsed = !isPreviewCollapsed"
          >
            <i class="fa-solid" :class="isPreviewCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
            {{ isPreviewCollapsed ? '展开' : '收起' }}
          </button>
        </div>

        <section v-show="!isPreviewCollapsed" class="wbm-preview">
          <div class="wbm-preview-actions" :class="{ 'speed-mode': optimizerMode !== 'cache' }">
            <button
              class="wbm-primary-btn wbm-generate-action"
              type="button"
              data-wbm-tutorial="generate-preview"
              :disabled="isBusy || !canPreview"
              @click="generateDefaultPreview"
            >
              <i class="fa-solid fa-magnifying-glass"></i>
              {{ generatePreviewButtonLabel }}
            </button>
            <button
              class="wbm-primary-btn wbm-apply-action"
              type="button"
              data-wbm-tutorial="apply"
              :disabled="isBusy || !canApply"
              @click="confirmApply"
            >
              <i class="fa-solid fa-check"></i>
              {{ applyButtonLabel }}
            </button>
            <button
              v-if="optimizerMode === 'cache'"
              class="wbm-small-btn wbm-structure-action"
              type="button"
              title="查看结构图"
              aria-label="查看结构图"
              data-wbm-tutorial="structure"
              :disabled="isBusy || previewRows.length === 0"
              @click="openStructureModal"
            >
              <i class="fa-solid fa-layer-group"></i>
              结构图
            </button>
            <label class="wbm-compact-field wbm-filter-field">
              <span class="wbm-compact-label">过滤</span>
              <select v-model="previewFilter" class="wbm-select" :disabled="isBusy">
                <option value="all">全部</option>
                <option value="changed">建议修改</option>
                <option value="review">待确认</option>
              </select>
            </label>
            <label class="wbm-compact-field wbm-sort-field">
              <span class="wbm-compact-label">排序</span>
              <select v-model="previewSortMode" class="wbm-select" :disabled="isBusy">
                <option value="custom">自定义</option>
                <option value="title_asc">标题 A 到 Z</option>
                <option value="title_desc">标题 Z 到 A</option>
                <option value="token_asc">{{ tokenSortLabel }} ↑</option>
                <option value="token_desc">{{ tokenSortLabel }} ↓</option>
                <option value="depth_asc">深度 ↑</option>
                <option value="depth_desc">深度 ↓</option>
                <option value="order_asc">顺序 ↑</option>
                <option value="order_desc">顺序 ↓</option>
                <option value="uid_asc">UID ↑</option>
                <option value="uid_desc">UID ↓</option>
                <option value="probability_asc">触发频率% ↑</option>
                <option value="probability_desc">触发频率% ↓</option>
                <option v-if="hasPrioritySort" value="priority_asc">优先级 ↑</option>
                <option v-if="hasPrioritySort" value="priority_desc">优先级 ↓</option>
              </select>
            </label>
            <div class="wbm-filter-stats" aria-live="polite">{{ visiblePreviewStats.label }}</div>
            <div
              v-if="previewRows.length > 0"
              class="wbm-blue-token-stats"
              :class="{ warning: postApplyBlueTokenStats.isOverThreshold }"
              aria-live="polite"
            >
              <i
                class="fa-solid"
                :class="postApplyBlueTokenStats.isOverThreshold ? 'fa-triangle-exclamation' : 'fa-circle-info'"
              ></i>
              <span>{{ postApplyBlueTokenStats.label }}</span>
              <strong v-if="postApplyBlueTokenStats.isOverThreshold">
                已超过 {{ blueTokenWarningThresholdLabel }}，应用前需再次确认
              </strong>
            </div>
          </div>
          <div class="wbm-card-list">
            <article
              v-for="item in visiblePreviewRows"
              :key="`card:${item.id}`"
              class="wbm-preview-card"
              :class="`state-${item.status}`"
              :data-wbm-preview-key="item.decisionKey || item.contentEditKey"
              tabindex="0"
            >
              <div class="wbm-card-head">
                <div class="wbm-entry-title">
                  <strong>{{ item.entryName }}</strong>
                  <button
                    class="wbm-icon-inline"
                    type="button"
                    :title="isPreviewExpanded(item.id) ? '收起内容' : '展开内容'"
                    @click="togglePreviewExpanded(item.id)"
                  >
                    <i class="fa-solid" :class="isPreviewExpanded(item.id) ? 'fa-caret-down' : 'fa-caret-right'"></i>
                  </button>
                  <template v-if="isContentEditing(item.contentEditKey)">
                    <button
                      class="wbm-icon-inline"
                      type="button"
                      title="保存正文修改"
                      :disabled="isBusy"
                      @click="saveContentEdit(item)"
                    >
                      <i class="fa-solid fa-check"></i>
                    </button>
                    <button
                      class="wbm-icon-inline"
                      type="button"
                      title="取消编辑"
                      :disabled="isBusy"
                      @click="cancelContentEdit(item)"
                    >
                      <i class="fa-solid fa-xmark"></i>
                    </button>
                  </template>
                  <button
                    v-else
                    class="wbm-icon-inline"
                    type="button"
                    title="编辑正文"
                    :disabled="isBusy || item.status === 'failed' || optimizerMode !== 'cache'"
                    @click="startContentEditing(item)"
                  >
                    <i class="fa-solid fa-pencil"></i>
                  </button>
                </div>
                <span>{{ previewStatusLabel(item) }}</span>
              </div>
              <p>
                {{ item.worldbook }} · UID {{ item.uidText }} · {{ item.tokenIsEstimated ? 'Token≈' : 'Token' }}
                {{ item.tokenCount }}
              </p>
              <div class="wbm-mobile-action">
                <div class="wbm-action-stack">
                  <select
                    v-if="item.actionChoices.length > 0"
                    class="wbm-select wbm-action-select"
                    :class="`tone-${actionTone(item)}`"
                    :value="actionSelectValue(item)"
                    :title="actionTitle(item)"
                    :disabled="isBusy"
                    @change="setEntryAction(item, $event)"
                  >
                    <option v-if="item.entryAction === 'custom'" value="custom_saved">
                      自定义 · {{ actionDetail(item) }}
                    </option>
                    <option v-for="choice in item.actionChoices" :key="choice.value" :value="choice.value">
                      {{ choice.label }}
                    </option>
                  </select>
                  <div v-else class="wbm-action-display" :class="`tone-${actionTone(item)}`" :title="actionTitle(item)">
                    <span class="wbm-action-dot" aria-hidden="true"></span>
                    <span class="wbm-action-label">{{ actionLabel(item) }}</span>
                    <span class="wbm-action-detail">{{ actionDetail(item) }}</span>
                  </div>
                </div>
              </div>
              <div class="wbm-card-meta-grid">
                <span>{{ beforeColumnLabel }}</span>
                <span class="wbm-state-pill" :class="`tone-${item.fromTone}`">
                  <span class="wbm-action-dot" aria-hidden="true"></span>
                  {{ item.fromStateText }}
                </span>
                <span>{{ afterColumnLabel }}</span>
                <span class="wbm-state-pill" :class="`tone-${item.toTone}`">
                  <span class="wbm-action-dot" aria-hidden="true"></span>
                  {{ item.toStateText }}
                </span>
                <span>顺序</span>
                <span>{{ item.orderText }}</span>
              </div>
              <div class="wbm-risk-list wbm-risk-list-compact">
                <span
                  v-for="risk in item.riskHits"
                  :key="`mobile:${item.id}:${risk.label}:${risk.excerpt}`"
                  :class="`risk-${risk.level}`"
                  :title="riskTitle(risk)"
                >
                  {{ riskDisplayLabel(risk) }}
                </span>
                <span v-if="item.riskHits.length === 0" class="risk-none">无动态内容</span>
              </div>
              <div v-if="isContentEditing(item.contentEditKey)" class="wbm-content-editor">
                <textarea
                  class="wbm-textarea"
                  :value="contentEditValue(item)"
                  :disabled="isBusy"
                  spellcheck="false"
                  @input="setContentEditDraft(item, $event)"
                ></textarea>
              </div>
              <div v-else-if="isPreviewExpanded(item.id)" class="wbm-content-preview">
                <template v-for="segment in contentSegments(item)" :key="`mobile-full:${item.id}:${segment.key}`">
                  <mark v-if="segment.level" :class="`risk-${segment.level}`">{{ segment.text }}</mark>
                  <span v-else>{{ segment.text }}</span>
                </template>
              </div>
            </article>
            <div v-if="visiblePreviewRows.length === 0" class="wbm-empty">{{ previewEmptyText }}</div>
          </div>

          <div class="wbm-table-wrap">
            <table class="wbm-table">
              <colgroup>
                <col class="wbm-col-entry" />
                <col class="wbm-col-before" />
                <col class="wbm-col-after" />
                <col class="wbm-col-order" />
                <col class="wbm-col-risk" />
                <col class="wbm-col-status" />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <div class="wbm-table-head-main">
                      <span>条目</span>
                      <small>{{ visiblePreviewStats.label }}</small>
                    </div>
                  </th>
                  <th>{{ beforeColumnLabel }}</th>
                  <th>{{ afterColumnLabel }}</th>
                  <th>顺序</th>
                  <th>{{ riskColumnLabel }}</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="item in visiblePreviewRows" :key="item.id">
                  <tr :class="`state-${item.status}`" :data-wbm-preview-key="item.decisionKey || item.contentEditKey">
                    <td class="wbm-entry-cell" :title="`${item.worldbook} / ${item.entryName}`">
                      <div class="wbm-entry-title">
                        <strong>{{ item.entryName }}</strong>
                        <button
                          class="wbm-icon-inline"
                          type="button"
                          :title="isPreviewExpanded(item.id) ? '收起内容' : '展开内容'"
                          @click="togglePreviewExpanded(item.id)"
                        >
                          <i
                            class="fa-solid"
                            :class="isPreviewExpanded(item.id) ? 'fa-caret-down' : 'fa-caret-right'"
                          ></i>
                        </button>
                        <template v-if="isContentEditing(item.contentEditKey)">
                          <button
                            class="wbm-icon-inline"
                            type="button"
                            title="保存正文修改"
                            :disabled="isBusy"
                            @click="saveContentEdit(item)"
                          >
                            <i class="fa-solid fa-check"></i>
                          </button>
                          <button
                            class="wbm-icon-inline"
                            type="button"
                            title="取消编辑"
                            :disabled="isBusy"
                            @click="cancelContentEdit(item)"
                          >
                            <i class="fa-solid fa-xmark"></i>
                          </button>
                        </template>
                        <button
                          v-else
                          class="wbm-icon-inline"
                          type="button"
                          title="编辑正文"
                          :disabled="isBusy || item.status === 'failed' || optimizerMode !== 'cache'"
                          @click="startContentEditing(item)"
                        >
                          <i class="fa-solid fa-pencil"></i>
                        </button>
                      </div>
                      <small
                        >{{ item.worldbook }} · UID {{ item.uidText }} ·
                        {{ item.tokenIsEstimated ? 'Token≈' : 'Token' }} {{ item.tokenCount }}</small
                      >
                    </td>
                    <td class="wbm-position-cell" :title="item.fromText">
                      <span class="wbm-state-pill" :class="`tone-${item.fromTone}`">
                        <span class="wbm-action-dot" aria-hidden="true"></span>
                        {{ item.fromStateText }}
                      </span>
                    </td>
                    <td class="wbm-action-cell">
                      <div class="wbm-action-stack">
                        <select
                          v-if="item.actionChoices.length > 0"
                          class="wbm-select wbm-action-select"
                          :class="`tone-${actionTone(item)}`"
                          :value="actionSelectValue(item)"
                          :title="actionTitle(item)"
                          :disabled="isBusy"
                          @change="setEntryAction(item, $event)"
                        >
                          <option v-if="item.entryAction === 'custom'" value="custom_saved">
                            自定义 · {{ actionDetail(item) }}
                          </option>
                          <option v-for="choice in item.actionChoices" :key="choice.value" :value="choice.value">
                            {{ choice.label }}
                          </option>
                        </select>
                        <div v-else class="wbm-action-display" :class="`tone-${item.toTone}`" :title="item.toText">
                          <span class="wbm-action-dot" aria-hidden="true"></span>
                          <span class="wbm-action-label">{{ item.toStateText }}</span>
                        </div>
                      </div>
                    </td>
                    <td :title="`酒馆顺序：${item.orderText}`">{{ item.orderText }}</td>
                    <td class="wbm-risk-cell" :title="item.riskText">
                      <div class="wbm-risk-line">
                        <span
                          v-for="risk in item.riskHits"
                          :key="`${item.id}:${risk.label}:${risk.excerpt}`"
                          :class="`risk-${risk.level}`"
                          :title="riskTitle(risk)"
                          >{{ riskDisplayLabel(risk) }}</span
                        >
                        <span v-if="item.riskHits.length === 0" class="risk-none">无</span>
                      </div>
                    </td>
                    <td>{{ previewStatusLabel(item) }}</td>
                  </tr>
                  <tr v-if="isPreviewExpanded(item.id)" class="wbm-expanded-row">
                    <td colspan="6">
                      <div v-if="isContentEditing(item.contentEditKey)" class="wbm-content-editor">
                        <textarea
                          class="wbm-textarea"
                          :value="contentEditValue(item)"
                          :disabled="isBusy"
                          spellcheck="false"
                          @input="setContentEditDraft(item, $event)"
                        ></textarea>
                      </div>
                      <div v-else class="wbm-content-preview">
                        <template v-for="segment in contentSegments(item)" :key="`full:${item.id}:${segment.key}`">
                          <mark v-if="segment.level" :class="`risk-${segment.level}`">{{ segment.text }}</mark>
                          <span v-else>{{ segment.text }}</span>
                        </template>
                      </div>
                    </td>
                  </tr>
                </template>
                <tr v-if="visiblePreviewRows.length === 0">
                  <td colspan="6" class="wbm-empty">当前过滤条件下没有修改意见。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <div
        v-if="activePanel === 'optimizer' && structureState.open"
        class="wbm-structure-modal"
        @click.self="closeStructureModal"
      >
        <section class="wbm-structure-box" role="dialog" aria-modal="true" aria-label="世界书结构图">
          <header class="wbm-structure-head">
            <div>
              <h3>修改前后结构图</h3>
              <p>默认只展示实际修改的条目；切到全部时会包含不处理、数据库和禁用条目。</p>
            </div>
            <div class="wbm-structure-head-actions">
              <div class="wbm-structure-toggle" role="group" aria-label="结构图显示范围">
                <button
                  type="button"
                  :class="{ active: structureGraphMode === 'changed' }"
                  @click="setStructureGraphMode('changed')"
                >
                  只看修改
                </button>
                <button
                  type="button"
                  :class="{ active: structureGraphMode === 'all' }"
                  @click="setStructureGraphMode('all')"
                >
                  全部
                </button>
              </div>
              <button class="wbm-icon-btn" type="button" title="关闭结构图" @click="closeStructureModal">
                <i class="fa-solid fa-times"></i>
              </button>
            </div>
          </header>
          <div class="wbm-structure-diagram">
            <article class="wbm-stack-visual wbm-before-stack">
              <h4>修改前</h4>
              <div class="wbm-cylinder">
                <div
                  v-for="bucket in structureGraph.before"
                  :key="`before:${bucket.key}`"
                  class="wbm-cylinder-layer"
                  :class="{
                    'is-interactive': true,
                    'is-highlighted': structureHighlightSource === bucket.key,
                    'is-dimmed': !!structureHighlightSource && structureHighlightSource !== bucket.key,
                  }"
                  :style="{
                    '--layer-weight': bucket.weight,
                    '--layer-top': bucket.top,
                    '--layer-height': bucket.height,
                  }"
                  :title="`${bucket.label} · ${bucket.count} 条`"
                  role="button"
                  tabindex="0"
                  @mouseenter="setStructureHighlight(bucket.key)"
                  @mouseleave="clearStructureHighlight"
                  @click="setStructureHighlight(bucket.key)"
                  @keydown.enter.prevent="toggleStructureHighlight(bucket.key)"
                  @keydown.space.prevent="toggleStructureHighlight(bucket.key)"
                >
                  <span>{{ bucket.label }}</span>
                  <strong>{{ bucket.count }}</strong>
                </div>
              </div>
            </article>
            <svg class="wbm-structure-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <g v-for="arrow in structureGraph.arrows" :key="`path:${arrow.key}`">
                <path
                  class="wbm-structure-path"
                  :class="{
                    'is-unchanged': arrow.changedCount === 0,
                    'is-highlighted': structureHighlightSource === arrow.from,
                    'is-dimmed': !!structureHighlightSource && structureHighlightSource !== arrow.from,
                  }"
                  :d="arrow.pathD"
                  :style="{ '--arrow-width': arrow.strokeWidth }"
                />
                <path
                  class="wbm-structure-arrow-head"
                  :class="{
                    'is-unchanged': arrow.changedCount === 0,
                    'is-highlighted': structureHighlightSource === arrow.from,
                    'is-dimmed': !!structureHighlightSource && structureHighlightSource !== arrow.from,
                  }"
                  :d="arrow.headD"
                />
              </g>
            </svg>
            <div class="wbm-structure-labels" aria-hidden="true">
              <span
                v-for="arrow in structureGraph.arrows"
                :key="`count:${arrow.key}`"
                class="wbm-structure-count"
                :class="{
                  'is-unchanged': arrow.changedCount === 0,
                  'is-highlighted': structureHighlightSource === arrow.from,
                  'is-dimmed': !!structureHighlightSource && structureHighlightSource !== arrow.from,
                }"
                :style="{ top: `${arrow.labelY}%` }"
              >
                {{ arrow.count }} 条
              </span>
            </div>
            <div v-if="structureGraph.arrows.length === 0" class="wbm-structure-empty">
              {{ structureGraphMode === 'changed' ? '没有实际修改的迁移。' : '没有可展示的迁移。' }}
            </div>
            <article class="wbm-stack-visual wbm-after-stack">
              <h4>修改后</h4>
              <div class="wbm-cylinder">
                <div
                  v-for="bucket in structureGraph.after"
                  :key="`after:${bucket.key}`"
                  class="wbm-cylinder-layer"
                  :class="{
                    'is-highlighted': structureHighlightedAfterKeys.has(bucket.key),
                    'is-dimmed': !!structureHighlightSource && !structureHighlightedAfterKeys.has(bucket.key),
                  }"
                  :style="{
                    '--layer-weight': bucket.weight,
                    '--layer-top': bucket.top,
                    '--layer-height': bucket.height,
                  }"
                  :title="`${bucket.label} · ${bucket.count} 条`"
                >
                  <span>{{ bucket.label }}</span>
                  <strong>{{ bucket.count }}</strong>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div
        v-if="activePanel === 'optimizer' && optimizerSettingsOpen"
        class="wbm-confirm wbm-optimizer-settings-modal"
        @click.self="closeOptimizerSettings"
      >
        <div class="wbm-confirm-box wbm-optimizer-settings-box" role="dialog" aria-modal="true" aria-label="优化设置">
          <header class="wbm-rule-help-head">
            <div>
              <h3>优化设置</h3>
              <p>调整缓存优化的条目范围和默认书单。</p>
            </div>
            <button class="wbm-icon-btn" type="button" title="关闭优化设置" @click="closeOptimizerSettings">
              <i class="fa-solid fa-times"></i>
            </button>
          </header>

          <section v-if="activePanel === 'optimizer'" class="wbm-optimizer-settings-group">
            <h4>优化缓存条目范围</h4>
            <div class="wbm-settings-choice-list" role="radiogroup" aria-label="优化缓存条目范围">
              <label
                v-for="option in CACHE_ENTRY_SCOPE_OPTIONS"
                :key="option.value"
                class="wbm-settings-choice"
                :class="{ active: cacheEntryScope === option.value }"
              >
                <input
                  v-model="cacheEntryScope"
                  type="radio"
                  name="wbm-cache-entry-scope"
                  :value="option.value"
                  :disabled="isBusy"
                />
                <span>
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
              </label>
            </div>
          </section>

          <section v-if="activePanel === 'optimizer'" class="wbm-optimizer-settings-group">
            <h4>默认选择世界书</h4>
            <div class="wbm-settings-choice-list" role="radiogroup" aria-label="默认选择世界书">
              <label
                v-for="option in DEFAULT_WORLD_BOOK_SELECTION_OPTIONS"
                :key="option.value"
                class="wbm-settings-choice"
                :class="{ active: defaultWorldbookSelection === option.value }"
              >
                <input
                  v-model="defaultWorldbookSelection"
                  type="radio"
                  name="wbm-default-worldbook-selection"
                  :value="option.value"
                  :disabled="isBusy"
                />
                <span>
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
              </label>
            </div>
          </section>

          <div class="wbm-dialog-actions">
            <button
              class="wbm-small-btn"
              type="button"
              :disabled="isBusy || !apiReady"
              @click="selectDefaultOptimizerBooks"
            >
              按设置自动选择
            </button>
            <button class="wbm-primary-btn" type="button" @click="closeOptimizerSettings">完成</button>
          </div>
        </div>
      </div>

      <div
        v-if="activePanel === 'optimizer' && ruleHelpOpen"
        class="wbm-confirm wbm-rule-help-modal"
        @click.self="closeRuleHelp"
      >
        <div class="wbm-confirm-box wbm-rule-help-box" role="dialog" aria-modal="true" :aria-label="ruleHelpAriaLabel">
          <header class="wbm-rule-help-head">
            <div>
              <h3>{{ ruleHelpTitle }}</h3>
            </div>
            <button class="wbm-icon-btn" type="button" title="关闭说明" @click="closeRuleHelp">
              <i class="fa-solid fa-times"></i>
            </button>
          </header>
          <div class="wbm-rule-help-list">
            <article
              v-for="item in activeRuleHelpItems"
              :key="item.id"
              class="wbm-rule-help-card"
              :class="`tone-${item.tone}`"
            >
              <div class="wbm-rule-help-title">
                <span class="wbm-action-dot" aria-hidden="true"></span>
                <strong>{{ item.label }}</strong>
                <small>{{ item.targetText }}</small>
              </div>
              <p>{{ item.description }}</p>
            </article>
          </div>
          <p class="wbm-rule-help-note">
            {{ ruleHelpNote }}
          </p>
        </div>
      </div>

      <div v-if="activePanel === 'optimizer' && customEditorState.open" class="wbm-confirm" @click.self="cancelCustomEditor">
        <div class="wbm-confirm-box wbm-custom-editor-box" role="dialog" aria-modal="true" aria-label="自定义修改后">
          <header class="wbm-custom-editor-head">
            <div>
              <h3>自定义修改后</h3>
              <p>
                {{ customEditorState.entryName }} · {{ customEditorState.worldbook }} · UID
                {{ customEditorState.uidText }}
              </p>
            </div>
            <button class="wbm-icon-btn" type="button" title="关闭自定义" @click="cancelCustomEditor">
              <i class="fa-solid fa-times"></i>
            </button>
          </header>

          <div class="wbm-custom-summary">
            <span class="wbm-state-pill" :class="`tone-${customEditorState.fromTone}`">
              <span class="wbm-action-dot" aria-hidden="true"></span>
              {{ customEditorState.fromText }}
            </span>
            <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            <span class="wbm-state-pill" :class="`tone-${customEditorTone}`">
              <span class="wbm-action-dot" aria-hidden="true"></span>
              {{
                customEditorState.draft.enabled
                  ? customEditorState.draft.strategyType === 'constant'
                    ? '蓝灯'
                    : '绿灯'
                  : '禁用'
              }}
              · {{ customEditorTargetLabel }}
            </span>
          </div>

          <div class="wbm-custom-grid">
            <label class="wbm-custom-field">
              <span>状态</span>
              <div class="wbm-segmented-control">
                <button
                  type="button"
                  :class="{ active: customEditorState.draft.enabled }"
                  @click="setCustomEnabled(true)"
                >
                  启用
                </button>
                <button
                  type="button"
                  :class="{ active: !customEditorState.draft.enabled }"
                  @click="setCustomEnabled(false)"
                >
                  禁用
                </button>
              </div>
            </label>

            <label class="wbm-custom-field" :class="{ muted: !customEditorState.draft.enabled }">
              <span>灯色</span>
              <div class="wbm-segmented-control">
                <button
                  type="button"
                  :disabled="!customEditorState.draft.enabled"
                  :class="{ active: customEditorState.draft.strategyType === 'constant' }"
                  @click="setCustomStrategy('constant')"
                >
                  <span class="wbm-action-dot tone-blue" aria-hidden="true"></span>
                  蓝灯
                </button>
                <button
                  type="button"
                  :disabled="!customEditorState.draft.enabled"
                  :class="{ active: customEditorState.draft.strategyType === 'selective' }"
                  @click="setCustomStrategy('selective')"
                >
                  <span class="wbm-action-dot tone-green" aria-hidden="true"></span>
                  绿灯
                </button>
              </div>
            </label>

            <label class="wbm-custom-field wbm-custom-field-wide">
              <span>插入位置</span>
              <select
                class="wbm-select"
                :value="customEditorState.draft.positionType"
                @change="setCustomPositionType($event)"
              >
                <option v-for="option in customPositionOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>

            <div
              v-if="customEditorState.draft.positionType === 'at_depth'"
              class="wbm-custom-field wbm-custom-field-wide"
            >
              <span>消息身份</span>
              <div class="wbm-segmented-control">
                <button
                  v-for="role in customRoleOptions"
                  :key="role.value"
                  type="button"
                  :class="{ active: customEditorState.draft.role === role.value }"
                  @click="setCustomRole(role.value)"
                >
                  {{ role.label }}
                </button>
              </div>
            </div>

            <label v-if="customEditorState.draft.positionType === 'at_depth'" class="wbm-custom-field">
              <span>深度 D</span>
              <input
                class="wbm-input"
                type="number"
                min="0"
                max="9999"
                step="1"
                :value="customEditorState.draft.depth"
                @input="setCustomNumber('depth', $event)"
              />
            </label>

            <label class="wbm-custom-field">
              <span>顺序 order</span>
              <input
                class="wbm-input"
                type="number"
                step="1"
                :value="customEditorState.draft.order"
                @input="setCustomNumber('order', $event)"
              />
            </label>

            <label class="wbm-custom-field">
              <span>触发概率 %</span>
              <input
                class="wbm-input"
                type="number"
                min="0"
                max="100"
                step="1"
                :value="customEditorState.draft.probability"
                @input="setCustomNumber('probability', $event)"
              />
            </label>
          </div>

          <div class="wbm-dialog-actions">
            <button
              class="wbm-small-btn"
              type="button"
              :disabled="!customEditorHasOverride"
              @click="clearCustomEditorOverride"
            >
              清除自定义
            </button>
            <button class="wbm-small-btn" type="button" @click="cancelCustomEditor">取消</button>
            <button class="wbm-primary-btn" type="button" @click="saveCustomEditor">保存自定义</button>
          </div>
        </div>
      </div>

      <div v-if="activePanel === 'optimizer' && confirmState.open" class="wbm-confirm" @click.self="cancelConfirm">
        <div class="wbm-confirm-box">
          <h3>应用前提醒</h3>
          <p>
            将应用 {{ confirmState.bookCount }} 本世界书中的
            {{ confirmState.changeCount }} {{ confirmChangeUnit }}。请自行备份，或确认这些世界书来自角色卡，
            出问题时可以删除修改后的世界书并重新导入角色卡来进行恢复。
          </p>
          <label class="wbm-toggle-line wbm-confirm-option">
            <input v-model="confirmState.doNotShowAgain" type="checkbox" />
            <span>不再显示这个提醒</span>
          </label>
          <div class="wbm-dialog-actions">
            <button class="wbm-small-btn" type="button" @click="cancelConfirm">取消</button>
            <button class="wbm-danger-btn" type="button" @click="applyChanges">确认应用</button>
          </div>
        </div>
      </div>
      <div
        v-if="activePanel === 'dedupe' && dedupeConfirmState.open"
        class="wbm-confirm"
        @click.self="cancelDedupeConfirm"
      >
        <div class="wbm-confirm-box" role="dialog" aria-modal="true" aria-label="确认应用世界书去重">
          <h3>确认应用去重</h3>
          <p>
            将处理 {{ dedupeConfirmState.groupCount }} 组候选，删除
            {{ dedupeConfirmState.deleteCount }} 本旧版本世界书。
            其中 {{ dedupeConfirmState.rebindCount }} 本检测到当前绑定，会先重绑到保留版本再删除。
            还会更新 {{ dedupeConfirmState.characterRebindCount }} 张角色卡的主世界书绑定。
          </p>
          <div class="wbm-dialog-actions">
            <button class="wbm-small-btn" type="button" @click="cancelDedupeConfirm">取消</button>
            <button class="wbm-danger-btn" type="button" @click="applyDedupeChanges">确认去重</button>
          </div>
        </div>
      </div>
      <div
        v-if="activePanel === 'optimizer' && blueTokenWarningState.open"
        class="wbm-confirm"
        @click.self="cancelBlueTokenWarning"
      >
        <div class="wbm-confirm-box wbm-token-warning-box" role="dialog" aria-modal="true" aria-label="蓝灯 Token 过高">
          <h3>蓝灯 Token 过高</h3>
          <p>
            应用后将有 {{ postApplyBlueTokenStats.count }} 个蓝灯条目，预计
            {{ postApplyBlueTokenStats.tokenLabel }} {{ postApplyBlueTokenStats.formattedTokenCount }}，已超过
            {{ blueTokenWarningThresholdLabel }}Tokens。应用修改可能导致上下文超限或AI请求直接失败，是否继续应用修改？
          </p>
          <label class="wbm-toggle-line wbm-confirm-option">
            <input v-model="blueTokenWarningState.doNotShowAgain" type="checkbox" />
            <span>不再显示这个提醒</span>
          </label>
          <div class="wbm-dialog-actions">
            <button class="wbm-small-btn" type="button" @click="cancelBlueTokenWarning">取消</button>
            <button class="wbm-danger-btn" type="button" @click="confirmBlueTokenWarning">仍然应用</button>
          </div>
        </div>
      </div>
      <div v-if="versionDialog.open" class="wbm-confirm wbm-version-modal" @click.self="closeVersionManager">
        <div class="wbm-confirm-box wbm-version-box" role="dialog" aria-modal="true" aria-label="版本管理">
          <div class="wbm-version-box-header">
            <div>
              <h3>版本管理</h3>
              <p>选择版本和分发源，处理缓存或网络问题。</p>
            </div>
            <button class="wbm-icon-btn wbm-version-close" type="button" title="关闭版本管理" @click="closeVersionManager">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>

          <div class="wbm-version-summary">
            <div>
              <span>当前版本</span>
              <strong>{{ APP_VERSION }}</strong>
            </div>
            <div>
              <span>最新版本</span>
              <strong>{{ latestVersionLabel }}</strong>
            </div>
            <div>
              <span>脚本来源</span>
              <strong>{{ scriptVersionSourceLabel }}</strong>
            </div>
          </div>

          <div v-if="scriptVersionSourceHint" class="wbm-version-hint" :class="scriptVersionSourceTone">
            <i class="fa-solid" :class="scriptVersionSourceIcon"></i>
            <span>{{ scriptVersionSourceHint }}</span>
          </div>

          <div v-if="versionCatalog.errorMessage" class="wbm-alert">
            {{ versionCatalog.errorMessage }}
          </div>

          <section class="wbm-version-source">
            <label class="wbm-version-source-field">
              <span>分发源</span>
              <select
                v-model="selectedVersionImportSource"
                class="wbm-select"
                :disabled="versionDialog.busy"
                @change="persistVersionImportSourcePreference"
              >
                <option v-for="source in versionImportSourceOptions" :key="source.id" :value="source.id">
                  {{ source.label }}
                </option>
              </select>
            </label>
            <p>{{ selectedVersionImportDescription }}</p>
            <label v-if="selectedVersionImportSource === CUSTOM_VERSION_IMPORT_SOURCE_ID" class="wbm-version-source-custom">
              <span>自定义模板</span>
              <input
                v-model.trim="customVersionImportTemplate"
                class="wbm-input"
                type="text"
                :disabled="versionDialog.busy"
                placeholder="https://.../{version}/dist/世界书管理器/index.js"
                @change="persistVersionImportSourcePreference"
                @blur="persistVersionImportSourcePreference"
              />
            </label>
            <p v-if="selectedVersionImportSource === CUSTOM_VERSION_IMPORT_SOURCE_ID" class="wbm-version-source-help">
              适合填自建反代或可信镜像。需要包含 <code>{version}</code>，并指向本仓库的
              <code>dist/世界书管理器/index.js</code>。
            </p>
            <p v-if="selectedVersionImportError" class="wbm-version-source-error">
              <i class="fa-solid fa-triangle-exclamation"></i>
              {{ selectedVersionImportError }}
            </p>
          </section>

          <div class="wbm-version-actions">
            <button
              class="wbm-primary-btn"
              type="button"
              :disabled="!latestVersion || !versionUpdateAvailable || versionDialog.busy || !!selectedVersionImportError"
              @click="latestVersion && requestVersionSwitch(latestVersion)"
            >
              <i class="fa-solid fa-cloud-arrow-down"></i>
              更新到最新版
            </button>
            <button class="wbm-small-btn" type="button" :disabled="versionCheckRunning" @click="refreshVersionManager">
              <i class="fa-solid fa-rotate"></i>
              刷新版本
            </button>
          </div>

          <div v-if="versionDialog.targetVersion" class="wbm-version-confirm-card">
            <div class="wbm-version-target-head">
              <div class="wbm-version-target-meta">
                <span>
                  目标版本
                  <strong>{{ versionDialog.targetVersion }}</strong>
                </span>
                <span>
                  分发源
                  <strong>{{ formatVersionImportSource(selectedVersionImportTemplate) }}</strong>
                </span>
              </div>
              <div class="wbm-version-target-actions">
                <button
                  class="wbm-small-btn"
                  type="button"
                  :disabled="!targetImportStatement"
                  @click="copyTargetImportStatement"
                >
                  <i class="fa-solid fa-copy"></i>
                  <span>复制</span>
                </button>
                <button class="wbm-small-btn" type="button" :disabled="versionDialog.busy" @click="cancelVersionSwitch">
                  取消
                </button>
                <button
                  class="wbm-danger-btn"
                  type="button"
                  :disabled="versionDialog.busy || !!selectedVersionImportError"
                  @click="confirmVersionSwitch"
                >
                  {{ versionSwitchButtonLabel }}
                </button>
              </div>
            </div>
            <code>{{ targetImportStatement || selectedVersionImportError }}</code>
          </div>

          <div v-if="versionDialog.successMessage" class="wbm-version-result success">
            <i class="fa-solid fa-circle-check"></i>
            <span>{{ versionDialog.successMessage }}</span>
            <button class="wbm-small-btn" type="button" @click="reloadPageForVersionChange">刷新页面</button>
          </div>

          <div class="wbm-version-list" data-wbm-version-list>
            <button
              v-for="row in versionRows"
              :key="row.version"
              class="wbm-version-row"
              :class="row.relation"
              type="button"
              :disabled="versionDialog.busy || row.relation === 'current'"
              @click="requestVersionSwitch(row.version)"
            >
              <span>{{ row.version }}</span>
              <em>{{ row.statusText }}</em>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import CacheInspectorPanel from './cache-inspector/CacheInspectorPanel.vue';
import { createBlueEntryMergePlan, type MergeGroup } from './blue-entry-merge';
import {
  createDuplicateWorldbookPlan,
  createDuplicateWorldbookRebindPlan,
  type DuplicateApplyResult,
  type DuplicateWorldbookCandidate,
  type DuplicateWorldbookCharacterBinding,
  type DuplicateWorldbookGroup,
  type DuplicateWorldbookSnapshot,
  type DuplicateWorldbookSource,
  type DuplicateWorldbookStrategy,
} from './duplicate-worldbook';
import { createCacheInspectorTutorial, createWorldbookTutorial } from './tutorial';
import {
  CUSTOM_VERSION_IMPORT_SOURCE_ID,
  DEFAULT_VERSION_IMPORT_TEMPLATE,
  VERSION_IMPORT_SOURCES,
  compareVersionTags,
  createScriptImportUrl,
  fetchVersionCatalog,
  getKnownVersionImportSourceByTemplate,
  inspectCurrentScriptVersion,
  replaceCurrentScriptVersion,
  validateVersionImportTemplate,
  versionRelation,
  type ScriptVersionSource,
  type VersionCatalog,
  type VersionImportSourceId,
  type VersionRelation,
} from './version-manager';

const APP_VERSION = 'v4.00';
const EMPTY_VERSION_CATALOG: VersionCatalog = {
  latestVersion: null,
  versions: [],
  checkedAt: 0,
  errorMessage: null,
};

type ActivePanel = 'optimizer' | 'cacheInspector' | 'dedupe';
type OptimizerMode = 'cache' | 'prompt_build_speed';
type CacheEntryScope = 'enabled' | 'all';
type DefaultWorldbookSelection = 'active' | 'global' | 'character' | 'chat';
type PreviewStatus = 'changed' | 'unchanged' | 'filtered' | 'failed';
type PreviewFilter = 'changed' | 'review' | 'all';
type StructureGraphMode = 'changed' | 'all';
type BookSortMode =
  | 'default'
  | 'selected'
  | 'name_asc'
  | 'name_desc'
  | 'source'
  | 'entry_desc'
  | 'token_desc'
  | 'dynamic_desc';
type BookSourceFilter = 'all' | 'active' | 'global' | 'character' | 'chat' | 'none';
type PreviewSortMode =
  | 'custom'
  | 'title_asc'
  | 'title_desc'
  | 'token_asc'
  | 'token_desc'
  | 'depth_asc'
  | 'depth_desc'
  | 'order_asc'
  | 'order_desc'
  | 'uid_asc'
  | 'uid_desc'
  | 'probability_asc'
  | 'probability_desc'
  | 'priority_asc'
  | 'priority_desc';
type EntryAction =
  | 'promote_to_blue_d0'
  | 'promote_to_blue_keep_position'
  | 'promote_to_blue_d9999'
  | 'keep_green_d0'
  | 'move_to_d0'
  | 'clear_cooldown'
  | 'custom'
  | 'disable'
  | 'skip';
type BookSource = 'global' | 'character_primary' | 'character_additional' | 'chat';
type RiskLevel = 'dynamic' | 'warning' | 'unknown';
type ActionTone = 'blue' | 'green' | 'orange' | 'disabled' | 'neutral' | 'edit';
type LampTone = 'blue' | 'green' | 'gray' | 'neutral';
type StaticDepthBand = 'tail' | 'fixed' | null;

type PositionTarget =
  | { type: Exclude<WorldbookEntry['position']['type'], 'at_depth'> }
  | { type: 'at_depth'; role: WorldbookEntry['position']['role']; depth: number };

type RuleFlowRow = {
  id: string;
  from: string;
  fromTone: ActionTone;
  to: string;
  toTone: ActionTone;
};

type RuleHelpItem = {
  id: string;
  label: string;
  targetText: string;
  description: string;
  tone: ActionTone;
};

type OptimizerModeOption = {
  value: OptimizerMode;
  label: string;
  subtitle: string;
  icon: string;
};

type BookSourceBadge = {
  value: BookSource;
  label: string;
  title: string;
};

type PreviewChange = {
  id: string;
  contentEditKey: string;
  previewIndex: number;
  originalIndex: number;
  promptRank: number;
  nextPromptRank: number;
  worldbook: string;
  uid: number;
  uidText: string;
  entryName: string;
  fromText: string;
  toText: string;
  nextEnabled: boolean;
  nextStrategyType: WorldbookEntry['strategy']['type'];
  nextPosition: WorldbookEntry['position'];
  nextProbability: number;
  fromStateText: string;
  toStateText: string;
  fromTone: LampTone;
  toTone: LampTone;
  cacheZoneText: string;
  strategyText: string;
  orderText: string;
  riskText: string;
  ruleLabel: string;
  status: PreviewStatus;
  changed: boolean;
  reviewNeeded: boolean;
  decisionKey: string | null;
  entryAction: EntryAction | null;
  actionChoices: ActionChoice[];
  originalContent: string;
  content: string;
  contentLength: number;
  contentEdited: boolean;
  tokenCount: number;
  tokenIsEstimated: boolean;
  mergeSourceCount?: number;
  depthValue: number;
  orderValue: number;
  nextOrderValue: number;
  probability: number;
  priorityValue: number | null;
  riskHits: RiskHit[];
};

type ApplyResult = {
  worldbook: string;
  changed: number;
  failed: boolean;
  errorMessage: string | null;
};

type DedupeConfirmState = {
  open: boolean;
  groupCount: number;
  deleteCount: number;
  rebindCount: number;
  characterRebindCount: number;
};

type LoadWorldbooksOptions = {
  defaultSelection?: DefaultWorldbookSelection | 'all';
};

type ConfirmState = {
  open: boolean;
  bookCount: number;
  changeCount: number;
  doNotShowAgain: boolean;
};

type BlueTokenWarningState = {
  open: boolean;
  doNotShowAgain: boolean;
};

type OptimizerFilterPreference = {
  optimizerMode: OptimizerMode;
  bookSourceFilter: BookSourceFilter;
  previewFilter: PreviewFilter;
  previewSortMode: PreviewSortMode;
  cacheEntryScope: CacheEntryScope;
  defaultWorldbookSelection: DefaultWorldbookSelection;
  dedupeStrategy: DuplicateWorldbookStrategy;
};

type CustomStrategyType = Extract<WorldbookEntry['strategy']['type'], 'constant' | 'selective'>;
type CustomPositionType = WorldbookEntry['position']['type'];

type CustomEntryOverride = {
  enabled: boolean;
  strategyType: CustomStrategyType;
  position: WorldbookEntry['position'];
  probability: number;
};

type CustomEditorDraft = {
  enabled: boolean;
  strategyType: CustomStrategyType;
  positionType: CustomPositionType;
  role: WorldbookEntry['position']['role'];
  depth: number;
  order: number;
  probability: number;
};

type CustomEditorState = {
  open: boolean;
  decisionKey: string | null;
  worldbook: string;
  uidText: string;
  entryName: string;
  fromText: string;
  fromTone: LampTone;
  draft: CustomEditorDraft;
};

type ActionSelectValue = EntryAction | 'custom_saved';

type ScrollSnapshot = {
  windowX: number;
  windowY: number;
  elements: Array<{ element: HTMLElement; left: number; top: number }>;
  anchor: ScrollAnchor | null;
};

type ScrollAnchor = {
  key: string;
  top: number;
  scroller: HTMLElement | null;
};

type GeneratePreviewOptions = {
  preserveScroll?: boolean;
  keepRowsUntilReady?: boolean;
  anchorKey?: string;
  scrollSnapshot?: ScrollSnapshot | null;
};

type ActionChoice = {
  value: EntryAction;
  label: string;
};

type RiskHit = {
  label: string;
  level: RiskLevel;
  excerpt: string;
  excerpts?: string[];
  count?: number;
};

type ContentSegment = {
  key: string;
  text: string;
  level: RiskLevel | null;
};

type MacroHit = {
  raw: string;
  name: string;
  args: string[];
};

type TokenCounter = (text: string) => Promise<number>;

type EntryPlan = {
  original: WorldbookEntry;
  next: WorldbookEntry;
  originalIndex: number;
  promptRank: number;
  contentEditKey: string;
  contentEdited: boolean;
  matched: boolean;
  ruleLabel: string;
  cacheZoneText: string;
  strategyText: string;
  riskHits: RiskHit[];
  riskText: string;
  decisionKey: string | null;
  entryAction: EntryAction | null;
  actionChoices: ActionChoice[];
  shouldRebalanceOrder: boolean;
};

type BookPlan = {
  rows: PreviewChange[];
  entries: WorldbookEntry[];
  changedCount: number;
};

type BuildBookPlanOptions = {
  includeDisabledEntries?: boolean;
};

type WorldbookImplicitFields = {
  addMemo: boolean;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  automationId: string;
  ignoreBudget: boolean;
  outletName: string;
  triggers: unknown[];
  characterFilter: {
    isExclude: boolean;
    names: string[];
    tags: string[];
  };
};

type WorldbookEntryWithImplicit = WorldbookEntry & Partial<WorldbookImplicitFields>;

type OriginalWorldbookEntry = WorldbookImplicitFields & {
  uid: number;
  displayIndex: number;
  comment: string;
  disable: boolean;
  constant: boolean;
  selective: boolean;
  key: string[];
  selectiveLogic: 0 | 1 | 2 | 3;
  keysecondary: string[];
  scanDepth: number | null;
  vectorized: boolean;
  position: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  role: 0 | 1 | 2 | null;
  depth: number;
  order: number;
  content: string;
  useProbability: boolean;
  probability: number;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean | number;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  extra?: Record<string, unknown>;
};

type BookMetadata = {
  entryCount: number;
  enabledCount: number;
  tokenEstimate: number;
  dynamicCount: number;
  loadedAt: number;
  errorMessage: string | null;
};

type MetadataProgress = {
  loaded: number;
  total: number;
  running: boolean;
};

type StructureState = {
  open: boolean;
};

type VersionDialogState = {
  open: boolean;
  targetVersion: string | null;
  busy: boolean;
  successMessage: string | null;
};

type VersionImportSourceSelection = VersionImportSourceId | typeof CUSTOM_VERSION_IMPORT_SOURCE_ID;

type StructureBucket = {
  key: string;
  label: string;
  count: number;
  weight: string;
  top: string;
  height: string;
  centerY: number;
};

type StructureArrow = {
  key: string;
  from: string;
  to: string;
  count: number;
  changedCount: number;
  fromY: number;
  toY: number;
  labelY: number;
  strokeWidth: string;
  pathD: string;
  headD: string;
};

const FIXED_CACHE_TARGET = { type: 'at_depth', role: 'user', depth: 9999 } as const;
const TAIL_ATTENTION_TARGET = { type: 'at_depth', role: 'user', depth: 0 } as const;
const TAIL_STATIC_DEPTH_LIMIT = 10;
const ORDER_BASE = 1000;
const ORDER_STEP = 10;
const FILTERED_TEXT = '-';
const DATABASE_PLUGIN_ENTRY_PREFIX = 'TavernDB-ACU';
const DATABASE_PLUGIN_RULE_LABEL = '数据库插件条目';
const DATABASE_PLUGIN_STATUS_TEXT = '请单独设置数据库';
const ENTRY_COOLDOWN_RISK_LABEL = '条目冷却设置';
const APPLY_WARNING_DISMISSED_KEY = 'worldbook_manager_apply_warning_dismissed_v1';
const BLUE_TOKEN_WARNING_DISMISSED_KEY = 'worldbook_manager_blue_token_warning_dismissed_v1';
const VERSION_IMPORT_SOURCE_PREF_KEY = 'worldbook_manager_version_import_source_v1';
const OPTIMIZER_FILTER_PREF_KEY = 'worldbook_manager_optimizer_filters_v1';
const BLUE_TOKEN_WARNING_THRESHOLD = 400_000;
const VISUAL_VIEWPORT_CSS_VAR = '--wbm-vvh';
const OPTIMIZER_MODE_OPTIONS: OptimizerModeOption[] = [
  {
    value: 'cache',
    label: '优化缓存',
    subtitle: '调整灯色、深度和冷却',
    icon: 'fa-gauge-high',
  },
  {
    value: 'prompt_build_speed',
    label: '优化提示词构建速度',
    subtitle: '合并同位置蓝灯条目',
    icon: 'fa-layer-group',
  },
];
const CACHE_ENTRY_SCOPE_OPTIONS: Array<{ value: CacheEntryScope; label: string; description: string }> = [
  {
    value: 'enabled',
    label: '仅处理启用条目',
    description: '保持默认行为，禁用条目不进入缓存优化规则。',
  },
  {
    value: 'all',
    label: '处理所有条目',
    description: '当前选中的世界书内，禁用条目也参与试算；应用后仍保持禁用。',
  },
];
const DEFAULT_WORLD_BOOK_SELECTION_OPTIONS: Array<{
  value: DefaultWorldbookSelection;
  label: string;
  description: string;
}> = [
  {
    value: 'active',
    label: '全局 + 角色 + 聊天',
    description: '打开优化器时默认选择当前启用的全部世界书。',
  },
  {
    value: 'character',
    label: '仅角色世界书',
    description: '默认选择当前角色主世界书和附加世界书。',
  },
  {
    value: 'global',
    label: '仅全局世界书',
    description: '默认选择当前启用的全局世界书。',
  },
  {
    value: 'chat',
    label: '仅聊天世界书',
    description: '默认选择当前聊天绑定的世界书。',
  },
];
const DEDUPE_STRATEGY_OPTIONS: Array<{
  value: DuplicateWorldbookStrategy;
  label: string;
  description: string;
  icon: string;
  ruleDetails: Array<{ title: string; description: string }>;
}> = [
  {
    value: 'conservative',
    label: '保守',
    description: '误报少，漏报会多。',
    icon: 'fa-shield-halved',
    ruleDetails: [
      { title: '比较对象', description: '只比较名字相近的世界书。' },
      { title: '查重算法', description: '几乎整本一样才算重复。' },
    ],
  },
  {
    value: 'balanced',
    label: '平衡',
    description: '默认推荐',
    icon: 'fa-scale-balanced',
    ruleDetails: [
      { title: '比较对象', description: '比较所有选中的世界书' },
      { title: '查重算法', description: '比较条目正文内容有没有大段重复。' },
    ],
  },
  {
    value: 'aggressive',
    label: '激进',
    description: '最激进的清理策略',
    icon: 'fa-bolt',
    ruleDetails: [
      { title: '比较对象', description: '比较所有选中的世界书' },
      { title: '查重算法', description: '条目正文只要有一部分重合就可会被检出。' },
    ],
  },
];
const DEFAULT_WORLDBOOK_IMPLICIT_FIELDS: WorldbookImplicitFields = {
  addMemo: true,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  group: '',
  groupOverride: false,
  groupWeight: 100,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  ignoreBudget: false,
  outletName: '',
  triggers: [],
  characterFilter: {
    isExclude: false,
    names: [],
    tags: [],
  },
};
const POSITION_TO_ORIGINAL: Record<WorldbookEntry['position']['type'], OriginalWorldbookEntry['position']> = {
  before_character_definition: 0,
  after_character_definition: 1,
  before_author_note: 2,
  after_author_note: 3,
  at_depth: 4,
  before_example_messages: 5,
  after_example_messages: 6,
  outlet: 7,
};
const ROLE_TO_ORIGINAL: Record<WorldbookEntry['position']['role'], NonNullable<OriginalWorldbookEntry['role']>> = {
  system: 0,
  user: 1,
  assistant: 2,
};
const SELECTIVE_LOGIC_TO_ORIGINAL: Record<
  WorldbookEntry['strategy']['keys_secondary']['logic'],
  OriginalWorldbookEntry['selectiveLogic']
> = {
  and_any: 0,
  not_all: 1,
  not_any: 2,
  and_all: 3,
};
let tokenCounterPromise: Promise<TokenCounter | null> | null = null;
let metadataRunId = 0;
const managerRootElement = ref<HTMLElement | null>(null);
const tutorial = createWorldbookTutorial({ root: () => managerRootElement.value });
const cacheInspectorTutorial = createCacheInspectorTutorial({ root: () => managerRootElement.value });
let lastTutorialStartAt = 0;

const STABLE_MACROS = new Set([
  'char',
  'user',
  'charifnotgroup',
  'description',
  'personality',
  'scenario',
  'persona',
  'charprompt',
  'charinstruction',
  'chardepthprompt',
  'charcreatornotes',
  'charversion',
  'mesexamples',
  'mesexamplesraw',
  'charfirstmessage',
  'systemprompt',
  'defaultsystemprompt',
  'authorsnote',
  'charauthorsnote',
  'defaultauthorsnote',
  'instructinput',
  'instructoutput',
  'instructfirstoutput',
  'instructlastoutput',
  'instructsystem',
  'instructseparator',
  'chatseparator',
  'chatstart',
  'reasoningprefix',
  'reasoningsuffix',
  'reasoningseparator',
  'newline',
  '//',
  'comment',
  'space',
  'noop',
  'trim',
  'reverse',
]);

const DYNAMIC_MACROS = new Set([
  'random',
  'pick',
  'roll',
  'time',
  'date',
  'weekday',
  'isotime',
  'isodate',
  'datetimeformat',
  'idleduration',
  'idle_duration',
  'timediff',
  'lastmessage',
  'lastmessageid',
  'lastusermessage',
  'lastcharmessage',
  'firstincludedmessageid',
  'firstdisplayedmessageid',
  'lastswipeid',
  'currentswipeid',
  'allchatrange',
  'summary',
  'input',
  'getvar',
  'setvar',
  'addvar',
  'incvar',
  'decvar',
  'hasvar',
  'deletevar',
  'getglobalvar',
  'setglobalvar',
  'addglobalvar',
  'incglobalvar',
  'decglobalvar',
  'hasglobalvar',
  'deleteglobalvar',
  'get_global_variable',
  'format_global_variable',
  'get_preset_variable',
  'format_preset_variable',
  'get_character_variable',
  'format_character_variable',
  'get_chat_variable',
  'format_chat_variable',
  'get_message_variable',
  'format_message_variable',
  'format_global_message',
  'format_preset_message',
  'format_character_message',
  'format_chat_message',
  'format_message_message',
]);

const WARNING_MACROS = new Set([
  'group',
  'groupnotmuted',
  'notchar',
  'model',
  'maxprompt',
  'maxcontexttokens',
  'maxresponsetokens',
  'ismobile',
  'hasextension',
]);

const LEGACY_STABLE_MACROS = new Set(['user', 'bot', 'char']);
const LEGACY_WARNING_MACROS = new Set(['group']);

const isOpen = ref(false);
const activePanel = ref<ActivePanel>('optimizer');
const optimizerFilterPreference = readOptimizerFilterPreference();
const optimizerMode = ref<OptimizerMode>(optimizerFilterPreference.optimizerMode);
const isBusy = ref(false);
const isSetupCollapsed = ref(false);
const isPreviewCollapsed = ref(false);
const bookFilter = ref('');
const bookSortMode = ref<BookSortMode>('default');
const selectedBookSortRank = ref<Record<string, number>>({});
const bookSourceFilter = ref<BookSourceFilter>(optimizerFilterPreference.bookSourceFilter);
const cacheEntryScope = ref<CacheEntryScope>(optimizerFilterPreference.cacheEntryScope);
const defaultWorldbookSelection = ref<DefaultWorldbookSelection>(
  optimizerFilterPreference.defaultWorldbookSelection,
);
const dedupeStrategy = ref<DuplicateWorldbookStrategy>(optimizerFilterPreference.dedupeStrategy);
const worldbookNames = ref<string[]>([]);
const selectedBooks = ref<Set<string>>(new Set());
const bookSources = ref<Record<string, BookSource[]>>({});
const characterWorldbookBindings = ref<DuplicateWorldbookCharacterBinding[]>([]);
const bookMetadata = ref<Record<string, BookMetadata>>({});
const metadataProgress = reactive<MetadataProgress>({ loaded: 0, total: 0, running: false });
const bookListElement = ref<HTMLElement | null>(null);
const previewRows = ref<PreviewChange[]>([]);
const applyResults = ref<ApplyResult[]>([]);
const dedupeGroups = ref<DuplicateWorldbookGroup[]>([]);
const dedupeSelectedGroupIds = ref<Set<string>>(new Set());
const dedupeKeepOverrides = ref<Record<string, string>>({});
const dedupeApplyResults = ref<DuplicateApplyResult[]>([]);
const dedupeConfirmState = reactive<DedupeConfirmState>({
  open: false,
  groupCount: 0,
  deleteCount: 0,
  rebindCount: 0,
  characterRebindCount: 0,
});
const previewFilter = ref<PreviewFilter>(optimizerFilterPreference.previewFilter);
const previewSortMode = ref<PreviewSortMode>(optimizerFilterPreference.previewSortMode);
const expandedPreviewIds = ref<Set<string>>(new Set());
const editingContentIds = ref<Set<string>>(new Set());
const selectionInitialized = ref(false);
const entryActionOverrides = ref<Record<string, EntryAction>>({});
const customEntryOverrides = ref<Record<string, CustomEntryOverride>>({});
const contentEditOverrides = ref<Record<string, string>>({});
const contentEditDrafts = ref<Record<string, string>>({});
const ruleHelpOpen = ref(false);
const optimizerSettingsOpen = ref(false);
const confirmState = reactive<ConfirmState>({ open: false, bookCount: 0, changeCount: 0, doNotShowAgain: false });
const applyWarningDismissed = ref(readApplyWarningDismissed());
const blueTokenWarningState = reactive<BlueTokenWarningState>({ open: false, doNotShowAgain: false });
const blueTokenWarningDismissed = ref(readBlueTokenWarningDismissed());
const versionDialog = reactive<VersionDialogState>({
  open: false,
  targetVersion: null,
  busy: false,
  successMessage: null,
});
const versionImportSourcePreference = readVersionImportSourcePreference();
const selectedVersionImportSource = ref<VersionImportSourceSelection>(versionImportSourcePreference.sourceId);
const customVersionImportTemplate = ref(versionImportSourcePreference.customTemplate);
const versionCatalog = ref<VersionCatalog>({ ...EMPTY_VERSION_CATALOG });
const versionCheckRunning = ref(false);
const scriptVersionSource = ref<ScriptVersionSource>(inspectCurrentScriptVersion());
const structureState = reactive<StructureState>({ open: false });
const structureGraphMode = ref<StructureGraphMode>('changed');
const customEditorState = reactive<CustomEditorState>({
  open: false,
  decisionKey: null,
  worldbook: '',
  uidText: '',
  entryName: '',
  fromText: '',
  fromTone: 'neutral',
  draft: createEmptyCustomDraft(),
});

const apiReady = computed(() => {
  return (
    typeof getWorldbookNames === 'function' &&
    typeof getWorldbook === 'function' &&
    typeof updateWorldbookWith === 'function'
  );
});

const dedupeApiReady = computed(() => {
  return (
    typeof getWorldbookNames === 'function' &&
    typeof getWorldbook === 'function' &&
    typeof deleteWorldbook === 'function'
  );
});

const activePanelTitle = computed(() => {
  if (activePanel.value === 'cacheInspector') return '缓存命中对比';
  if (activePanel.value === 'dedupe') return '世界书智能去重';
  return '世界书缓存优化器';
});

const latestVersion = computed(() => versionCatalog.value.latestVersion);
const latestVersionLabel = computed(() => latestVersion.value ?? '未检查');
const versionUpdateAvailable = computed(() => {
  return latestVersion.value ? compareVersionTags(latestVersion.value, APP_VERSION) > 0 : false;
});
const versionManagerButtonTitle = computed(() => {
  if (versionCheckRunning.value) return '正在检查版本';
  if (versionUpdateAvailable.value && latestVersion.value) return `可更新到 ${latestVersion.value}`;
  if (versionCatalog.value.errorMessage) return '版本检查失败，点击查看';
  return '版本管理';
});
const versionManagerButtonIcon = computed(() => {
  return 'fa-rotate';
});
const versionRows = computed(() => {
  return versionCatalog.value.versions.map(version => {
    const relation = versionRelation(version, APP_VERSION);
    return {
      version,
      relation,
      statusText: versionStatusText(relation),
    };
  });
});
const versionImportSourceOptions = computed(() => [
  ...VERSION_IMPORT_SOURCES,
  {
    id: CUSTOM_VERSION_IMPORT_SOURCE_ID,
    label: '自定义模板',
    description: '自己填写可访问的代理或镜像模板，适合特殊网络环境。',
    template: customVersionImportTemplate.value,
  },
]);
const selectedKnownVersionImportSource = computed(() => {
  if (selectedVersionImportSource.value === CUSTOM_VERSION_IMPORT_SOURCE_ID) return null;
  return VERSION_IMPORT_SOURCES.find(source => source.id === selectedVersionImportSource.value) ?? null;
});
const selectedVersionImportTemplate = computed(() => {
  return selectedKnownVersionImportSource.value?.template ?? customVersionImportTemplate.value;
});
const selectedVersionImportValidation = computed(() => validateVersionImportTemplate(selectedVersionImportTemplate.value));
const selectedVersionImportDescription = computed(() => {
  return selectedKnownVersionImportSource.value?.description ?? '模板需要包含 {version}，并指向本仓库的 index.js。';
});
const selectedVersionImportError = computed(() => {
  return selectedVersionImportValidation.value.ok ? null : selectedVersionImportValidation.value.message;
});
const targetVersionImportUrl = computed(() => {
  if (!versionDialog.targetVersion || !selectedVersionImportValidation.value.ok) return '';
  return createScriptImportUrl(versionDialog.targetVersion, selectedVersionImportValidation.value.template);
});
const targetImportStatement = computed(() => {
  return targetVersionImportUrl.value ? formatImportStatement(targetVersionImportUrl.value) : '';
});
const targetVersionRelation = computed(() => {
  return versionDialog.targetVersion ? versionRelation(versionDialog.targetVersion, APP_VERSION) : null;
});
const versionSwitchButtonLabel = computed(() => {
  if (targetVersionRelation.value === 'older') return '回退为此版本';
  if (targetVersionRelation.value === 'newer') return '更新为此版本';
  return '切换为此版本';
});
const scriptVersionSourceLabel = computed(() => {
  const source = scriptVersionSource.value;
  if (source.status === 'versioned') return `${source.specifier} · ${formatVersionImportSource(source.importTemplate)} · ${formatScriptScope(source.scope)}`;
  if (source.status === 'main') return `main · ${formatVersionImportSource(source.importTemplate)} · ${formatScriptScope(source.scope)}`;
  if (source.status === 'api_unavailable') return '脚本 API 不可用';
  if (source.status === 'not_found') return '未找到当前脚本';
  if (source.status === 'ambiguous') return '脚本位置不唯一';
  if (source.status === 'no_import') return '非标准入口';
  if (source.status === 'unsupported') return '版本格式不支持';
  return '检查失败';
});
const scriptVersionSourceHint = computed(() => {
  const source = scriptVersionSource.value;
  if (source.status === 'versioned') {
    return getKnownVersionImportSourceByTemplate(source.importTemplate)
      ? null
      : '当前脚本使用自定义分发源；本次更新或回退会沿用你在下方选择的分发源。';
  }
  if (source.status === 'main') return '当前使用 main，无法精确说明正在运行的 tag；选择列表中的版本后会改成固定版本。';
  return source.message;
});
const scriptVersionSourceTone = computed(() => {
  if (scriptVersionSource.value.status === 'main' || scriptVersionSource.value.status === 'versioned') return 'info';
  return 'warning';
});
const scriptVersionSourceIcon = computed(() => {
  if (scriptVersionSource.value.status === 'main' || scriptVersionSource.value.status === 'versioned') return 'fa-circle-info';
  return 'fa-triangle-exclamation';
});

const customPositionOptions: Array<{ value: CustomPositionType; label: string }> = [
  { value: 'before_character_definition', label: '角色定义前' },
  { value: 'after_character_definition', label: '角色定义后' },
  { value: 'before_example_messages', label: '示例消息前' },
  { value: 'after_example_messages', label: '示例消息后' },
  { value: 'before_author_note', label: '作者注释前' },
  { value: 'after_author_note', label: '作者注释后' },
  { value: 'at_depth', label: '指定深度' },
  { value: 'outlet', label: '锚点' },
];

const customRoleOptions: Array<{ value: WorldbookEntry['position']['role']; label: string }> = [
  { value: 'system', label: '系统' },
  { value: 'user', label: '用户' },
  { value: 'assistant', label: 'AI' },
];

const customEditorTargetLabel = computed(() => formatPosition(draftToPosition(customEditorState.draft)));
const customEditorTone = computed<LampTone>(() => {
  if (!customEditorState.draft.enabled) return 'gray';
  return customEditorState.draft.strategyType === 'constant' ? 'blue' : 'green';
});
const customEditorHasOverride = computed(() => {
  return !!customEditorState.decisionKey && customEntryOverrides.value[customEditorState.decisionKey] !== undefined;
});

const ruleHelpItems: RuleHelpItem[] = [
  {
    id: 'cooldown-setting',
    label: '冷却设置',
    description:
      '酒馆里的冷却会让条目触发后隔几轮才再次生效，可能导致不同轮次发送给 AI 的提示词不一样。修改后会把冷却设为 0，也就是取消冷却。',
    targetText: '取消冷却',
    tone: 'orange',
  },
  {
    id: 'dynamic-risk-to-d0',
    label: '动态提示词 / 宏',
    description:
      '检测到 EJS、变量、MVU、随机、时间、消息变量或未知宏等会变化的内容时，默认移动到用户D0，并保持原来的灯色。因为涉及动态内容，会标为待确认，最好逐条确认是否可以修改为静态固定位置的内容。',
    targetText: '保持灯色用户D0',
    tone: 'orange',
  },
  {
    id: 'static-tail-depth',
    label: 'D0-D9 静态内容',
    description:
      '大量不同深度的内容会分别插在最近几次用户输入之间，破坏缓存。无动态内容、且原本在 D0-D9 的浅层条目，修改后统一放到用户D0；如果绿灯静态内容原本排在动态内容前面，会改成蓝灯，以固定动态内容前的提示词；排在动态内容后面的绿灯，因为动态内容本来就会破坏缓存，因此继续保留原灯色。',
    targetText: '用户D0',
    tone: 'green',
  },
  {
    id: 'static-fixed-depth',
    label: 'D10+ 静态内容',
    description:
      '无动态内容、且原本在 D10 或更深位置的深层条目，修改后放到用户D9999且改为蓝灯。也就是浅层 D0-D9 统一为用户D0，深层 D10+的条目统一为蓝灯用户D9999，避免插入D1-D9998等中间深度的条目破坏缓存。',
    targetText: '用户D9999',
    tone: 'blue',
  },
  {
    id: 'static-green-nondepth',
    label: '绿灯非深度静态',
    description: '无动态内容、且不是指定深度条目的绿灯，修改后保持作者原位置，但改为蓝灯，保证每轮发给AI同样的指示词。',
    targetText: '原位置',
    tone: 'green',
  },
  {
    id: 'static-blue-nondepth',
    label: '蓝灯非深度静态',
    description:
      '无动态内容、且不是指定深度条目的蓝灯，修改后保留蓝灯和原位置。如果它原本在 D0、D1 这类指定深度里，则会按对应的深度规则移动。',
    targetText: '保留',
    tone: 'blue',
  },
];

const speedRuleHelpItems: RuleHelpItem[] = [
  {
    id: 'speed-scope',
    label: '跨世界书范围',
    description:
      '所有选中的世界书会一起生成合并意见，但实际保存严格限制在各自世界书内，不会把 A 书条目合并到 B 书。',
    targetText: '分书落地',
    tone: 'blue',
  },
  {
    id: 'speed-content',
    label: '条目拼接',
    description:
      '同组源条目会按酒馆原本插入提示词的顺序，用一个换行边界拼成新蓝灯正文；新条目顶部会加 {{// 合并来源：...}} 注释记录源条目名，酒馆会把这个注释宏替换为空，不传入上下文。',
    targetText: '带来源注释',
    tone: 'green',
  },
  {
    id: 'speed-delete',
    label: '源条目处理',
    description:
      '应用时会新增一条合并后的蓝灯条目，并删除这一组里的源蓝灯条目。因此 UID 和条目数量会变化，应用前仍建议备份。',
    targetText: '删除源条目',
    tone: 'orange',
  },
  {
    id: 'speed-safety',
    label: '风险跳过',
    description:
      '带动态风险、示例消息、锚点、概率/预算/冷却/递归延迟、角色过滤、分组、触发器等行为差异的条目不会参与合并。',
    targetText: '保守合并',
    tone: 'orange',
  },
];

const ruleFlowRows: RuleFlowRow[] = [
  {
    id: 'cooldown',
    from: '冷却设置',
    fromTone: 'orange',
    to: '取消冷却',
    toTone: 'neutral',
  },
  {
    id: 'dynamic',
    from: '动态提示词 / 宏',
    fromTone: 'orange',
    to: '保持灯色用户D0',
    toTone: 'neutral',
  },
  {
    id: 'tail-depth',
    from: 'D0-D9 静态内容',
    fromTone: 'green',
    to: '用户D0',
    toTone: 'blue',
  },
  {
    id: 'fixed-depth',
    from: 'D10+ 静态内容',
    fromTone: 'blue',
    to: '用户D9999',
    toTone: 'blue',
  },
  {
    id: 'green-nondepth',
    from: '绿灯非深度静态',
    fromTone: 'green',
    to: '原位置',
    toTone: 'blue',
  },
  {
    id: 'blue-nondepth',
    from: '蓝灯非深度静态',
    fromTone: 'blue',
    to: '保留',
    toTone: 'blue',
  },
];

const speedRuleFlowRows: RuleFlowRow[] = [
  {
    id: 'speed-scope',
    from: '同书同位置蓝灯',
    fromTone: 'blue',
    to: '合并为一条',
    toTone: 'blue',
  },
  {
    id: 'speed-content',
    from: '条目拼接',
    fromTone: 'green',
    to: '换行分隔',
    toTone: 'blue',
  },
  {
    id: 'speed-comment',
    from: '源条目名',
    fromTone: 'neutral',
    to: '顶部注释',
    toTone: 'neutral',
  },
  {
    id: 'speed-risk',
    from: '风险条目',
    fromTone: 'orange',
    to: '保持原样',
    toTone: 'neutral',
  },
];

function ruleFlowLabelUnits(label: string): number {
  return Math.max(
    4,
    Array.from(label).reduce((total, char) => {
      if (/\s/.test(char)) return total + 0.35;
      if (/[A-Za-z0-9]/.test(char)) return total + 0.58;
      if (/[-+/@]/.test(char)) return total + 0.48;
      return total + 1;
    }, 0),
  );
}

function ruleFlowLabelStyle(label: string): Record<string, string> {
  const fitCqw = Math.min(16, Math.max(8.8, 82 / ruleFlowLabelUnits(label)));
  return { '--flow-label-fit': `${fitCqw.toFixed(2)}cqw` };
}

const filteredWorldbookNames = computed(() => {
  const keyword = bookFilter.value.trim().toLowerCase();
  const names = worldbookNames.value.filter(name => {
    if (keyword && !name.toLowerCase().includes(keyword)) return false;
    return matchesBookSourceFilter(name);
  });
  return [...names].sort(compareWorldbookNamesForDisplay);
});

const activeWorldbookNames = computed(() =>
  worldbookNames.value.filter(name => (bookSources.value[name] ?? []).length > 0),
);

const optimizerTargetWorldbookNames = computed(() =>
  [...selectedBooks.value].filter(name => worldbookNames.value.includes(name)),
);

const includeDisabledEntriesForCache = computed(
  () => optimizerMode.value === 'cache' && cacheEntryScope.value === 'all',
);

const validationMessage = computed(() => {
  if (!apiReady.value) return '世界书 API 不可用。';
  if (optimizerTargetWorldbookNames.value.length === 0) return '请至少选择一本世界书。';
  return '';
});

const canPreview = computed(() => apiReady.value && !validationMessage.value);

const currentModeOption = computed(
  () => OPTIMIZER_MODE_OPTIONS.find(option => option.value === optimizerMode.value) ?? OPTIMIZER_MODE_OPTIONS[0],
);
const currentDedupeStrategyOption = computed(
  () => DEDUPE_STRATEGY_OPTIONS.find(option => option.value === dedupeStrategy.value) ?? DEDUPE_STRATEGY_OPTIONS[1],
);
const currentDedupeRuleDetails = computed(() => currentDedupeStrategyOption.value.ruleDetails);

const isPromptBuildSpeedMode = computed(() => optimizerMode.value === 'prompt_build_speed');

const previewSectionTitle = computed(() => (isPromptBuildSpeedMode.value ? '合并意见区' : '修改意见区'));

const previewSectionSummary = computed(() =>
  isPromptBuildSpeedMode.value
    ? `命中 ${previewSummary.value.matched} · 建议合并 ${previewSummary.value.changed} · 待确认 ${previewSummary.value.review}`
    : `命中 ${previewSummary.value.matched} · 建议修改 ${previewSummary.value.changed} · 待确认 ${previewSummary.value.review}`,
);

const generatePreviewButtonLabel = computed(() => '生成方案');
const applyButtonLabel = computed(() => (isPromptBuildSpeedMode.value ? '应用合并' : '应用修改'));
const previewEmptyText = computed(() =>
  isPromptBuildSpeedMode.value ? '当前过滤条件下没有合并意见。' : '当前过滤条件下没有修改意见。',
);
const beforeColumnLabel = computed(() => (isPromptBuildSpeedMode.value ? '合并前' : '修改前'));
const afterColumnLabel = computed(() => (isPromptBuildSpeedMode.value ? '合并后' : '修改后'));
const riskColumnLabel = computed(() => (isPromptBuildSpeedMode.value ? '安全检查' : '动态内容'));
const confirmChangeUnit = computed(() => (isPromptBuildSpeedMode.value ? '个合并方案' : '个建议'));
const ruleHelpTitle = computed(() => (isPromptBuildSpeedMode.value ? '合并规则说明' : '修改规则说明'));
const ruleHelpAriaLabel = computed(() => ruleHelpTitle.value);
const activeRuleHelpItems = computed(() => (isPromptBuildSpeedMode.value ? speedRuleHelpItems : ruleHelpItems));
const activeRuleFlowRows = computed(() => (isPromptBuildSpeedMode.value ? speedRuleFlowRows : ruleFlowRows));
const ruleMapBeforeLabel = computed(() => (isPromptBuildSpeedMode.value ? '合并前' : '修改前'));
const ruleMapAfterLabel = computed(() => (isPromptBuildSpeedMode.value ? '合并后' : '修改后'));
const ruleHelpNote = computed(() =>
  isPromptBuildSpeedMode.value
    ? '合并功能只处理世界书本体里的安全蓝灯条目；摘要、总结插件、数据库和隐藏消息用正则仍需在对应功能里单独处理。'
    : '摘要、总结插件、数据库和隐藏消息用正则不属于世界书本体，需要在对应功能里单独处理。',
);

const previewSummary = computed(() => {
  return previewRows.value.reduce(
    (summary, row) => {
      if (row.status === 'changed') summary.changed += 1;
      if (row.status === 'unchanged') summary.unchanged += 1;
      if (row.status === 'failed') summary.failed += 1;
      if (row.reviewNeeded) summary.review += 1;
      if (row.status === 'changed' || row.status === 'unchanged') summary.matched += 1;
      return summary;
    },
    { matched: 0, changed: 0, unchanged: 0, failed: 0, review: 0 },
  );
});

const canApply = computed(() => previewSummary.value.changed > 0 && apiReady.value);

const canGenerateDedupePreview = computed(() => dedupeApiReady.value && selectedBooks.value.size >= 2);

const dedupeSelectedGroups = computed(() =>
  dedupeGroups.value.filter(group => isDedupeGroupSelected(group.id) && dedupeDeleteCandidates(group).length > 0),
);

const dedupeSelectedDeleteCount = computed(() =>
  dedupeSelectedGroups.value.reduce((sum, group) => sum + dedupeDeleteCandidates(group).length, 0),
);

const dedupeSelectedRebindCount = computed(() =>
  dedupeSelectedGroups.value.reduce(
    (sum, group) => sum + dedupeDeleteCandidates(group).filter(candidate => candidate.sources.length > 0).length,
    0,
  ),
);
const dedupeSelectedCharacterRebindCount = computed(() =>
  dedupeSelectedGroups.value.reduce((sum, group) => sum + dedupeGroupCharacterRebindCount(group), 0),
);

const canApplyDedupe = computed(() => dedupeApiReady.value && dedupeSelectedDeleteCount.value > 0);

const dedupeSummaryLabel = computed(() => {
  if (dedupeGroups.value.length === 0) return '尚未生成方案';
  const lowCount = dedupeGroups.value.filter(group => group.confidence === 'low').length;
  return `候选 ${dedupeGroups.value.length} 组 · 默认删除 ${dedupeSelectedDeleteCount.value} 本 · 低置信度 ${lowCount} 组`;
});

const dedupeSelectionLabel = computed(() => {
  if (dedupeGroups.value.length === 0) return `已选择 ${selectedBooks.value.size} 本用于扫描`;
  return `已勾选 ${dedupeSelectedGroups.value.length} 组 · 待删除 ${dedupeSelectedDeleteCount.value} 本`;
});

const dedupeEmptyText = computed(() =>
  selectedBooks.value.size < 2 ? '至少选择两本世界书后再生成方案。' : '还没有发现可处理的重复候选。',
);

const visiblePreviewRows = computed(() => {
  return sortPreviewRows(filterPreviewRows(previewRows.value));
});

const visiblePreviewStats = computed(() => {
  const rows = visiblePreviewRows.value;
  const tokenCount = rows.reduce((sum, row) => sum + row.tokenCount, 0);
  const tokenLabel = rows.some(row => row.tokenIsEstimated) ? 'Token≈' : 'Token';
  return {
    count: rows.length,
    tokenCount,
    label: `${rows.length} 条 · ${tokenLabel}${tokenCount}`,
  };
});

const postApplyBlueTokenStats = computed(() => {
  if (isPromptBuildSpeedMode.value) {
    const rows = previewRows.value.filter(row => row.status !== 'failed' && row.changed);
    const tokenCount = rows.reduce((sum, row) => sum + row.tokenCount, 0);
    const reducedCount = rows.reduce((sum, row) => sum + Math.max(0, (row.mergeSourceCount ?? 1) - 1), 0);
    const tokenLabel = rows.some(row => row.tokenIsEstimated) ? 'Token≈' : 'Token';
    return {
      count: rows.length,
      tokenCount,
      tokenLabel,
      formattedTokenCount: formatTokenCount(tokenCount),
      isOverThreshold: false,
      label: `待合并 ${rows.length} 组 · 净减少 ${reducedCount} 条蓝灯 · ${tokenLabel} ${formatTokenCount(tokenCount)}`,
    };
  }

  const rows = previewRows.value.filter(
    row => row.status !== 'failed' && row.nextEnabled && row.nextStrategyType === 'constant',
  );
  const tokenCount = rows.reduce((sum, row) => sum + row.tokenCount, 0);
  const tokenLabel = rows.some(row => row.tokenIsEstimated) ? 'Token≈' : 'Token';
  return {
    count: rows.length,
    tokenCount,
    tokenLabel,
    formattedTokenCount: formatTokenCount(tokenCount),
    isOverThreshold: tokenCount > BLUE_TOKEN_WARNING_THRESHOLD,
    label: `修改后蓝灯 ${rows.length} 条 · ${tokenLabel} ${formatTokenCount(tokenCount)}`,
  };
});
const blueTokenWarningThresholdLabel = formatTokenCount(BLUE_TOKEN_WARNING_THRESHOLD);

const hasPrioritySort = computed(() => previewRows.value.some(row => row.priorityValue !== null));

const tokenSortLabel = computed(() => (previewRows.value.some(row => row.tokenIsEstimated) ? 'Token≈' : 'Token'));

const structureRows = computed(() => {
  const rows = previewRows.value.filter(row => row.status !== 'failed');
  return structureGraphMode.value === 'changed' ? rows.filter(row => row.changed) : rows;
});
const structureGraph = computed(() => buildStructureGraph(structureRows.value));
const structureHighlightSource = ref<string | null>(null);
const structureHighlightedAfterKeys = computed(() => {
  const source = structureHighlightSource.value;
  if (!source) return new Set<string>();
  return new Set(structureGraph.value.arrows.filter(arrow => arrow.from === source).map(arrow => arrow.to));
});

const OPEN_CACHE_INSPECTOR_EVENT = 'worldbook-manager:open-cache-inspector';
const OPEN_DEDUPE_EVENT = 'worldbook-manager:open-dedupe';
const openManagerFromScriptButton = () => openManager();
const openCacheInspectorFromScriptButton = () => openCacheInspector();
const openDedupeFromScriptButton = () => openDedupe();

function filterPreviewRows(rows: PreviewChange[]): PreviewChange[] {
  const includeFailed = (row: PreviewChange) => row.status === 'failed';
  if (previewFilter.value === 'changed') return rows.filter(row => row.changed || includeFailed(row));
  if (previewFilter.value === 'review') return rows.filter(row => row.reviewNeeded || includeFailed(row));
  return rows;
}

function sortPreviewRows(rows: PreviewChange[]): PreviewChange[] {
  const sorted = [...rows];
  const tie = (left: PreviewChange, right: PreviewChange) => left.previewIndex - right.previewIndex;
  const byText = (left: PreviewChange, right: PreviewChange, direction: 1 | -1) =>
    direction * left.entryName.localeCompare(right.entryName, 'zh-Hans-CN') || tie(left, right);
  const byNumber = (
    left: PreviewChange,
    right: PreviewChange,
    selector: (row: PreviewChange) => number,
    direction: 1 | -1,
  ) => direction * (selector(left) - selector(right)) || tie(left, right);
  const byNullableNumber = (
    left: PreviewChange,
    right: PreviewChange,
    selector: (row: PreviewChange) => number | null,
    direction: 1 | -1,
  ) => {
    const leftValue = selector(left);
    const rightValue = selector(right);
    if (leftValue === null && rightValue === null) return tie(left, right);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return direction * (leftValue - rightValue) || tie(left, right);
  };

  sorted.sort((left, right) => {
    switch (previewSortMode.value) {
      case 'title_asc':
        return byText(left, right, 1);
      case 'title_desc':
        return byText(left, right, -1);
      case 'token_asc':
        return byNumber(left, right, row => row.tokenCount, 1);
      case 'token_desc':
        return byNumber(left, right, row => row.tokenCount, -1);
      case 'depth_asc':
        return byNumber(left, right, row => row.depthValue, 1);
      case 'depth_desc':
        return byNumber(left, right, row => row.depthValue, -1);
      case 'order_asc':
        return byNumber(left, right, row => row.nextOrderValue, 1);
      case 'order_desc':
        return byNumber(left, right, row => row.nextOrderValue, -1);
      case 'uid_asc':
        return byNumber(left, right, row => row.uid, 1);
      case 'uid_desc':
        return byNumber(left, right, row => row.uid, -1);
      case 'probability_asc':
        return byNumber(left, right, row => row.probability, 1);
      case 'probability_desc':
        return byNumber(left, right, row => row.probability, -1);
      case 'priority_asc':
        return byNullableNumber(left, right, row => row.priorityValue, 1);
      case 'priority_desc':
        return byNullableNumber(left, right, row => row.priorityValue, -1);
      case 'custom':
      default:
        return tie(left, right);
    }
  });

  return sorted;
}

function buildStructureGraph(rows: PreviewChange[]): {
  before: StructureBucket[];
  after: StructureBucket[];
  arrows: StructureArrow[];
} {
  const beforeMap = new Map<string, { label: string; count: number; rank: number }>();
  const afterMap = new Map<string, { label: string; count: number; rank: number }>();
  const arrowCounts = new Map<string, { from: string; to: string; count: number; changedCount: number }>();

  rows.forEach(row => {
    const beforeKey = structureBeforeKey(row);
    const afterKey = structureAfterKey(row);
    if (!beforeKey && !afterKey) return;

    if (beforeKey) {
      const before = beforeMap.get(beforeKey) ?? { label: beforeKey, count: 0, rank: row.promptRank };
      before.count += 1;
      before.rank = Math.min(before.rank, row.promptRank);
      beforeMap.set(beforeKey, before);
    }

    if (afterKey) {
      const after = afterMap.get(afterKey) ?? { label: afterKey, count: 0, rank: row.nextPromptRank };
      after.count += 1;
      after.rank = Math.min(after.rank, row.nextPromptRank);
      afterMap.set(afterKey, after);
    }

    if (beforeKey && afterKey) {
      const arrowKey = `${beforeKey}->${afterKey}`;
      const arrow = arrowCounts.get(arrowKey) ?? { from: beforeKey, to: afterKey, count: 0, changedCount: 0 };
      arrow.count += 1;
      if (row.changed) arrow.changedCount += 1;
      arrowCounts.set(arrowKey, arrow);
    }
  });

  const normalize = (items: Array<{ label: string; count: number; rank: number }>): StructureBucket[] => {
    const maxCount = Math.max(1, ...items.map(item => item.count));
    const sorted = items.sort(
      (left, right) => left.rank - right.rank || left.label.localeCompare(right.label, 'zh-Hans-CN'),
    );
    const totalWeight = sorted.reduce((sum, item) => sum + Math.max(18, Math.round((item.count / maxCount) * 100)), 0);
    let cursor = 6;
    const usableHeight = 88;
    return sorted.map(item => {
      const weightNumber = Math.max(18, Math.round((item.count / maxCount) * 100));
      const height = totalWeight === 0 ? 0 : (weightNumber / totalWeight) * usableHeight;
      const top = cursor;
      const centerY = cursor + height / 2;
      cursor += height;
      return {
        key: item.label,
        label: item.label,
        count: item.count,
        weight: String(weightNumber),
        top: `${Math.round(top * 10) / 10}%`,
        height: `${Math.round(height * 10) / 10}%`,
        centerY: Math.round(centerY * 10) / 10,
      };
    });
  };

  const before = normalize([...beforeMap.values()]);
  const after = normalize([...afterMap.values()]);
  const beforeCenters = new Map(before.map(bucket => [bucket.key, bucket.centerY]));
  const afterCenters = new Map(after.map(bucket => [bucket.key, bucket.centerY]));
  const maxArrowCount = Math.max(1, ...[...arrowCounts.values()].map(arrow => arrow.count));
  const arrowEntries = [...arrowCounts.entries()].sort((left, right) => {
    const leftFromY = beforeCenters.get(left[1].from) ?? 50;
    const rightFromY = beforeCenters.get(right[1].from) ?? 50;
    const leftToY = afterCenters.get(left[1].to) ?? 50;
    const rightToY = afterCenters.get(right[1].to) ?? 50;
    return (
      leftFromY - rightFromY ||
      leftToY - rightToY ||
      right[1].count - left[1].count ||
      left[0].localeCompare(right[0], 'zh-Hans-CN')
    );
  });
  const sourceGroupSizes = new Map<string, number>();
  const sourceGroupIndexes = new Map<string, number>();
  arrowEntries.forEach(([, arrow]) => {
    sourceGroupSizes.set(arrow.from, (sourceGroupSizes.get(arrow.from) ?? 0) + 1);
  });
  const arrows = arrowEntries
    .map(([key, arrow]) => {
      const fromY = beforeCenters.get(arrow.from) ?? 50;
      const toY = afterCenters.get(arrow.to) ?? 50;
      const groupSize = sourceGroupSizes.get(arrow.from) ?? 1;
      const groupIndex = sourceGroupIndexes.get(arrow.from) ?? 0;
      sourceGroupIndexes.set(arrow.from, groupIndex + 1);
      const curveOffset = groupSize > 1 ? (groupIndex - (groupSize - 1) / 2) * 8 : 0;
      const controlFromY = clampNumber(fromY + curveOffset, 4, 96);
      const controlToY = clampNumber(toY + curveOffset, 4, 96);
      const labelY = Math.round(clampNumber((fromY + toY) / 2 + curveOffset * 0.55, 4, 96) * 10) / 10;
      const headTipX = 61;
      const headBaseX = 59.72;
      const headHalfHeight = 0.72;
      const headTopY = clampNumber(toY - headHalfHeight, 3, 97);
      const headBottomY = clampNumber(toY + headHalfHeight, 3, 97);
      return {
        key,
        from: arrow.from,
        to: arrow.to,
        count: arrow.count,
        changedCount: arrow.changedCount,
        fromY,
        toY,
        labelY,
        strokeWidth: String(0.75 + Math.pow(arrow.count / maxArrowCount, 0.55) * 1.05),
        pathD: `M 39 ${fromY} C 47 ${controlFromY}, 53 ${controlToY}, ${headBaseX} ${toY}`,
        headD: `M ${headTipX} ${toY} L ${headBaseX} ${headTopY} L ${headBaseX} ${headBottomY} Z`,
      };
    })
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'zh-Hans-CN'));

  return {
    before,
    after,
    arrows,
  };
}

function structureBeforeKey(row: PreviewChange): string | null {
  if (!row.changed && row.fromTone === 'gray' && !row.nextEnabled) return null;
  if (row.fromTone === 'gray') return '禁用';
  return row.fromText || FILTERED_TEXT;
}

function structureAfterKey(row: PreviewChange): string | null {
  if (!row.changed && row.fromTone === 'gray' && !row.nextEnabled) return null;
  if (!row.nextEnabled) return '禁用';
  if (row.ruleLabel === DATABASE_PLUGIN_RULE_LABEL) return '数据库插件（单独设置）';
  return row.toText || FILTERED_TEXT;
}

onMounted(() => {
  window.addEventListener('worldbook-manager:open', openManagerFromScriptButton);
  window.addEventListener(OPEN_CACHE_INSPECTOR_EVENT, openCacheInspectorFromScriptButton);
  window.addEventListener(OPEN_DEDUPE_EVENT, openDedupeFromScriptButton);
  document.addEventListener('click', handleTutorialTriggerClick, true);
  syncVisualViewportHeight();
  window.visualViewport?.addEventListener('resize', syncVisualViewportHeight);
  window.visualViewport?.addEventListener('scroll', syncVisualViewportHeight);
  window.addEventListener('resize', syncVisualViewportHeight);
  void checkVersionCatalog({ silent: true });
});

onUnmounted(() => {
  window.removeEventListener('worldbook-manager:open', openManagerFromScriptButton);
  window.removeEventListener(OPEN_CACHE_INSPECTOR_EVENT, openCacheInspectorFromScriptButton);
  window.removeEventListener(OPEN_DEDUPE_EVENT, openDedupeFromScriptButton);
  document.removeEventListener('click', handleTutorialTriggerClick, true);
  window.visualViewport?.removeEventListener('resize', syncVisualViewportHeight);
  window.visualViewport?.removeEventListener('scroll', syncVisualViewportHeight);
  window.removeEventListener('resize', syncVisualViewportHeight);
  tutorial.close();
  cacheInspectorTutorial.close();
});

function openManager(): void {
  console.info('[世界书缓存优化器] 打开管理器');
  activePanel.value = 'optimizer';
  isOpen.value = true;
  cacheInspectorTutorial.close();
  syncVisualViewportHeight();
  applyWarningDismissed.value = readApplyWarningDismissed();
  blueTokenWarningDismissed.value = readBlueTokenWarningDismissed();
  selectionInitialized.value = false;
  if (apiReady.value) {
    void loadWorldbooks();
  }
  scheduleTutorialStart();
}

function openCacheInspector(): void {
  console.info('[缓存命中对比] 打开缓存命中对比');
  activePanel.value = 'cacheInspector';
  isOpen.value = true;
  syncVisualViewportHeight();
  tutorial.close();
  closeTransientModals();
  scheduleTutorialStart();
}

function openDedupe(): void {
  console.info('[世界书智能去重] 打开智能去重');
  activePanel.value = 'dedupe';
  isOpen.value = true;
  syncVisualViewportHeight();
  tutorial.close();
  cacheInspectorTutorial.close();
  closeTransientModals();
  selectionInitialized.value = false;
  resetDedupeState();
  if (dedupeApiReady.value) {
    void loadWorldbooksForDedupe();
  }
}

function closeManager(): void {
  if (activePanel.value !== 'cacheInspector' && isBusy.value) return;
  isOpen.value = false;
  tutorial.close();
  cacheInspectorTutorial.close();
  ruleHelpOpen.value = false;
  optimizerSettingsOpen.value = false;
  confirmState.open = false;
  blueTokenWarningState.open = false;
  dedupeConfirmState.open = false;
  closeVersionManager();
  structureState.open = false;
  closeCustomEditor();
}

watch(
  [optimizerMode, bookSourceFilter, previewFilter, previewSortMode, cacheEntryScope, defaultWorldbookSelection, dedupeStrategy],
  persistOptimizerFilterPreference,
);

watch(cacheEntryScope, () => {
  previewRows.value = [];
  applyResults.value = [];
  structureState.open = false;
  structureHighlightSource.value = null;
  resetPreviewManualState();
});

watch(dedupeStrategy, () => {
  resetDedupeState();
});

function openOptimizerSettings(): void {
  closeTransientModals();
  optimizerSettingsOpen.value = true;
  scheduleModalViewportSync();
}

function closeOptimizerSettings(): void {
  optimizerSettingsOpen.value = false;
}

function openVersionManager(): void {
  versionDialog.open = true;
  resetVersionDialogMessages();
  refreshScriptVersionSource({ syncImportSource: true });
  scheduleModalViewportSync();
  if (!versionCatalog.value.checkedAt || versionCatalog.value.errorMessage) {
    void checkVersionCatalog({ silent: false });
  }
}

function closeVersionManager(): void {
  versionDialog.open = false;
  versionDialog.targetVersion = null;
}

function refreshVersionManager(): void {
  resetVersionDialogMessages();
  refreshScriptVersionSource({ syncImportSource: true });
  void checkVersionCatalog({ silent: false, force: true });
}

function requestVersionSwitch(version: string): void {
  versionDialog.targetVersion = version;
  versionDialog.successMessage = null;
}

function cancelVersionSwitch(): void {
  versionDialog.targetVersion = null;
}

async function confirmVersionSwitch(): Promise<void> {
  if (!versionDialog.targetVersion || versionDialog.busy || !selectedVersionImportValidation.value.ok) return;
  versionDialog.busy = true;
  versionDialog.successMessage = null;
  persistVersionImportSourcePreference();
  try {
    const result = await replaceCurrentScriptVersion(
      versionDialog.targetVersion,
      { importTemplate: selectedVersionImportValidation.value.template },
    );
    if (result.ok) {
      versionDialog.targetVersion = null;
      versionDialog.successMessage = `已将「${result.scriptName}」切换到 ${result.targetVersion}，刷新页面后生效。`;
      refreshScriptVersionSource();
      notifySuccess('版本入口已更新，刷新页面后生效。');
      return;
    }

    notifyError(`${result.reason} 请点击目标 import 旁的「复制」，然后粘贴到酒馆助手本脚本的内容栏。`);
  } catch (error) {
    notifyError(`${formatError(error)} 请点击目标 import 旁的「复制」，然后粘贴到酒馆助手本脚本的内容栏。`);
  } finally {
    versionDialog.busy = false;
  }
}

async function checkVersionCatalog(options: { silent: boolean; force?: boolean }): Promise<void> {
  if (versionCheckRunning.value && !options.force) return;
  versionCheckRunning.value = true;
  try {
    const nextCatalog = await fetchVersionCatalog({ currentVersion: APP_VERSION, limit: 20 });
    versionCatalog.value = nextCatalog;
    if (nextCatalog.errorMessage && !options.silent) notifyError(nextCatalog.errorMessage);
  } catch (error) {
    versionCatalog.value = {
      ...EMPTY_VERSION_CATALOG,
      checkedAt: Date.now(),
      errorMessage: formatError(error),
    };
    if (!options.silent) notifyError('版本检查失败。');
  } finally {
    versionCheckRunning.value = false;
  }
}

function refreshScriptVersionSource(options: { syncImportSource?: boolean } = {}): void {
  scriptVersionSource.value = inspectCurrentScriptVersion();
  if (options.syncImportSource) syncVersionImportSourceFromScript(scriptVersionSource.value);
}

function resetVersionDialogMessages(): void {
  versionDialog.targetVersion = null;
  versionDialog.successMessage = null;
}

function syncVersionImportSourceFromScript(source: ScriptVersionSource): void {
  if ((source.status !== 'versioned' && source.status !== 'main') || !source.importTemplate) return;
  const knownSource = getKnownVersionImportSourceByTemplate(source.importTemplate);
  if (knownSource) {
    selectedVersionImportSource.value = knownSource.id;
  } else {
    selectedVersionImportSource.value = CUSTOM_VERSION_IMPORT_SOURCE_ID;
    customVersionImportTemplate.value = source.importTemplate;
  }
  persistVersionImportSourcePreference();
}

function persistVersionImportSourcePreference(): void {
  if (
    selectedVersionImportSource.value !== CUSTOM_VERSION_IMPORT_SOURCE_ID &&
    !VERSION_IMPORT_SOURCES.some(source => source.id === selectedVersionImportSource.value)
  ) {
    selectedVersionImportSource.value = 'jsdelivr';
  }
  if (selectedVersionImportSource.value !== CUSTOM_VERSION_IMPORT_SOURCE_ID && !customVersionImportTemplate.value) {
    customVersionImportTemplate.value = DEFAULT_VERSION_IMPORT_TEMPLATE;
  }
  if (typeof updateVariablesWith !== 'function') return;
  try {
    updateVariablesWith(
      variables => ({
        ...variables,
        [VERSION_IMPORT_SOURCE_PREF_KEY]: {
          sourceId: selectedVersionImportSource.value,
          customTemplate: customVersionImportTemplate.value,
        },
      }),
      { type: 'script' },
    );
  } catch (error) {
    console.warn(`[世界书缓存优化器] 保存版本分发源失败：${formatError(error)}`);
  }
}

async function copyTargetImportStatement(): Promise<void> {
  if (!targetImportStatement.value) return;
  try {
    await copyTextToClipboard(targetImportStatement.value);
    notifyInfo('已复制目标版本 import 语句。');
  } catch (error) {
    console.warn(`[世界书缓存优化器] 复制 import 语句失败：${formatError(error)}`);
    notifyError('复制失败，请手动选择 import 语句。');
  }
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (typeof builtin !== 'undefined' && typeof builtin.copyText === 'function') {
      builtin.copyText(text);
      return;
    }
  } catch {
    // Continue through the other clipboard paths.
  }

  try {
    copyTextWithSelection(text);
    return;
  } catch {
    // Continue through the other clipboard paths.
  }

  try {
    if (typeof triggerSlash === 'function') {
      await triggerSlash(`/clipboard-set ${text}`);
      return;
    }
  } catch {
    // Continue through the async Clipboard API.
  }

  try {
    await navigator.clipboard?.writeText(text);
    if (navigator.clipboard?.writeText) {
      return;
    }
  } catch {
    // Embedded webviews and non-secure contexts often block Clipboard API.
  }

  throw new Error('无法写入系统剪贴板');
}

function copyTextWithSelection(text: string): void {
  const textarea = document.createElement('textarea');
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '0';
  textarea.style.top = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('document.execCommand("copy") returned false');
  } finally {
    document.body.removeChild(textarea);
    activeElement?.focus({ preventScroll: true });
  }
}

function reloadPageForVersionChange(): void {
  if (typeof triggerSlash === 'function') {
    void triggerSlash('/reload-page');
    return;
  }
  window.location.reload();
}

function versionStatusText(relation: VersionRelation): string {
  if (relation === 'current') return '当前';
  if (relation === 'newer') return '可更新';
  return '可回退';
}

function formatScriptScope(scope: string): string {
  if (scope === 'global') return '全局脚本';
  if (scope === 'preset') return '预设脚本';
  if (scope === 'character') return '角色脚本';
  return scope;
}

function formatVersionImportSource(template: string): string {
  return getKnownVersionImportSourceByTemplate(template)?.label ?? '自定义源';
}

function formatImportStatement(importUrl: string): string {
  return `import '${importUrl}';`;
}

function handleTutorialTriggerClick(event: MouseEvent): void {
  const target =
    event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-wbm-tutorial-trigger]') : null;
  if (!target || target.disabled || isBusy.value) return;
  startTutorial();
}

function startTutorial(): void {
  const now = Date.now();
  if (now - lastTutorialStartAt < 160) return;
  lastTutorialStartAt = now;
  console.info(activePanel.value === 'cacheInspector' ? '[缓存命中对比] 播放内置教程' : '[世界书缓存优化器] 播放内置教程');
  void nextTick(() => {
    if (activePanel.value === 'cacheInspector') {
      cacheInspectorTutorial.start({ manual: true, interrupt: true });
    } else {
      tutorial.start({ manual: true, interrupt: true });
    }
  });
}

function scheduleTutorialStart(): void {
  void nextTick(() => {
    window.setTimeout(() => {
      if (!isOpen.value) return;
      if (activePanel.value === 'cacheInspector') {
        cacheInspectorTutorial.maybeStart();
      } else {
        tutorial.maybeStart();
      }
    }, 220);
  });
}

async function loadWorldbooks(options: LoadWorldbooksOptions = {}): Promise<void> {
  if (options.defaultSelection === 'all' ? !dedupeApiReady.value : !apiReady.value) return;
  isBusy.value = true;
  try {
    const names = getWorldbookNames();
    worldbookNames.value = [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    bookSources.value = collectActiveBookSources(worldbookNames.value);
    pruneBookMetadata(worldbookNames.value);
    if (!selectionInitialized.value) {
      const defaultSelection = options.defaultSelection ?? defaultWorldbookSelection.value;
      selectedBooks.value = new Set(worldbookNamesForDefaultSelection(defaultSelection));
      selectionInitialized.value = true;
    } else {
      selectedBooks.value = new Set([...selectedBooks.value].filter(name => worldbookNames.value.includes(name)));
    }
    previewRows.value = [];
    expandedPreviewIds.value = new Set();
    editingContentIds.value = new Set();
    entryActionOverrides.value = {};
    customEntryOverrides.value = {};
    contentEditOverrides.value = {};
    contentEditDrafts.value = {};
    closeCustomEditor();
    void loadBookMetadataInBackground(worldbookNames.value);
  } catch (error) {
    notifyError(`读取世界书列表失败：${formatError(error)}`);
  } finally {
    isBusy.value = false;
  }
}

async function loadWorldbooksForDedupe(options: { resetDedupe?: boolean } = {}): Promise<void> {
  if (!dedupeApiReady.value) return;
  if (options.resetDedupe !== false) resetDedupeState();
  await loadWorldbooks({ defaultSelection: 'all' });
}

function selectFilteredBooks(): void {
  selectedBooks.value = new Set(filteredWorldbookNames.value);
  previewRows.value = [];
  expandedPreviewIds.value = new Set();
  editingContentIds.value = new Set();
  entryActionOverrides.value = {};
  customEntryOverrides.value = {};
  contentEditOverrides.value = {};
  contentEditDrafts.value = {};
  closeCustomEditor();
  resetDedupeState();
}

function handleBookSortClick(): void {
  if (bookSortMode.value === 'selected') {
    refreshSelectedBookSortRank();
  }
}

function handleBookSortChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as BookSortMode;
  bookSortMode.value = value;
  if (value === 'selected') {
    refreshSelectedBookSortRank();
  }
}

function refreshSelectedBookSortRank(): void {
  const selected = selectedBooks.value;
  selectedBookSortRank.value = Object.fromEntries(worldbookNames.value.map(name => [name, selected.has(name) ? 0 : 1]));
}

async function selectActiveBooks(): Promise<void> {
  if (!apiReady.value) return;
  if (worldbookNames.value.length === 0) {
    await loadWorldbooks();
  } else {
    refreshBookSources();
  }
  const activeNames = activeWorldbookNames.value;
  selectedBooks.value = new Set(activeNames);
  previewRows.value = [];
  expandedPreviewIds.value = new Set();
  editingContentIds.value = new Set();
  entryActionOverrides.value = {};
  customEntryOverrides.value = {};
  contentEditOverrides.value = {};
  contentEditDrafts.value = {};
  closeCustomEditor();
  if (activeNames.length === 0) {
    notifyInfo('没有检测到当前启用的全局、角色或聊天世界书。');
  } else {
    notifyInfo(`已自动选择当前启用世界书：${activeNames.length} 本。`);
  }
  resetDedupeState();
}

async function selectDefaultOptimizerBooks(): Promise<void> {
  if (!apiReady.value) return;
  if (worldbookNames.value.length === 0) {
    await loadWorldbooks();
  } else {
    refreshBookSources();
  }
  const names = worldbookNamesForDefaultSelection(defaultWorldbookSelection.value);
  selectedBooks.value = new Set(names);
  previewRows.value = [];
  expandedPreviewIds.value = new Set();
  editingContentIds.value = new Set();
  entryActionOverrides.value = {};
  customEntryOverrides.value = {};
  contentEditOverrides.value = {};
  contentEditDrafts.value = {};
  closeCustomEditor();
  const option = DEFAULT_WORLD_BOOK_SELECTION_OPTIONS.find(item => item.value === defaultWorldbookSelection.value);
  notifyInfo(
    names.length === 0
      ? '没有检测到符合默认设置的世界书。'
      : `已按「${option?.label ?? '默认设置'}」选择 ${names.length} 本。`,
  );
  resetDedupeState();
}

function worldbookNamesForDefaultSelection(selection: DefaultWorldbookSelection | 'all'): string[] {
  if (selection === 'all') return worldbookNames.value;
  return worldbookNames.value.filter(name => matchesDefaultWorldbookSelection(name, selection));
}

function matchesDefaultWorldbookSelection(name: string, selection: DefaultWorldbookSelection): boolean {
  const sources = bookSources.value[name] ?? [];
  if (selection === 'active') return sources.length > 0;
  if (selection === 'global') return sources.includes('global');
  if (selection === 'character') {
    return sources.includes('character_primary') || sources.includes('character_additional');
  }
  return sources.includes('chat');
}

function collectActiveBookSources(availableNames: string[]): Record<string, BookSource[]> {
  const available = new Map<string, string>();
  for (const name of availableNames) {
    available.set(name, name);
    available.set(name.trim(), name);
    available.set(stripWorldbookExtension(name), name);
  }
  const sources: Record<string, BookSource[]> = {};
  const add = (name: string | null | undefined, source: BookSource) => {
    const resolvedName = resolveAvailableWorldbookName(name, available);
    if (!resolvedName) return;
    sources[resolvedName] = sources[resolvedName] ?? [];
    if (!sources[resolvedName].includes(source)) sources[resolvedName].push(source);
  };
  const addMany = (names: unknown, source: BookSource) => {
    for (const name of toStringArray(names)) add(name, source);
  };

  try {
    if (typeof getGlobalWorldbookNames === 'function') {
      addMany(getGlobalWorldbookNames(), 'global');
    }
    if (typeof getLorebookSettings === 'function') {
      addMany(getLorebookSettings().selected_global_lorebooks, 'global');
    }
  } catch (error) {
    notifyError(`读取全局世界书绑定失败：${formatError(error)}`);
  }

  try {
    if (typeof getCharWorldbookNames === 'function') {
      const charBooks = getCharWorldbookNames('current');
      add(charBooks.primary, 'character_primary');
      addMany(charBooks.additional, 'character_additional');
    }
    if (typeof getCharLorebooks === 'function') {
      const legacyCharBooks = getCharLorebooks();
      add(legacyCharBooks.primary, 'character_primary');
      addMany(legacyCharBooks.additional, 'character_additional');
    }
    if (typeof getCurrentCharPrimaryLorebook === 'function') {
      add(getCurrentCharPrimaryLorebook(), 'character_primary');
    }
  } catch (error) {
    notifyError(`读取角色世界书绑定失败：${formatError(error)}`);
  }

  try {
    if (typeof getChatWorldbookName === 'function') {
      add(getChatWorldbookName('current'), 'chat');
    }
    if (typeof getChatLorebook === 'function') {
      add(getChatLorebook(), 'chat');
    }
  } catch (error) {
    notifyError(`读取聊天世界书绑定失败：${formatError(error)}`);
  }

  return sources;
}

function refreshBookSources(): void {
  bookSources.value = collectActiveBookSources(worldbookNames.value);
}

async function collectAllCharacterWorldbookBindings(): Promise<DuplicateWorldbookCharacterBinding[]> {
  if (typeof getCharacterNames !== 'function' || typeof getCharacter !== 'function') return [];
  const bindings: DuplicateWorldbookCharacterBinding[] = [];
  const failures: string[] = [];
  let names: string[] = [];

  try {
    names = getCharacterNames();
  } catch (error) {
    notifyError(`读取角色卡列表失败：${formatError(error)}`);
    return bindings;
  }

  for (const characterName of names) {
    try {
      const character = await getCharacter(characterName);
      bindings.push({
        characterName,
        worldbook: typeof character.worldbook === 'string' ? character.worldbook : null,
      });
    } catch (error) {
      failures.push(`${characterName}: ${formatError(error)}`);
    }
  }

  if (failures.length > 0) {
    notifyError(`部分角色卡绑定读取失败：${failures.slice(0, 3).join('；')}`);
  }
  return bindings;
}

function resolveAvailableWorldbookName(name: string | null | undefined, available: Map<string, string>): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  return available.get(name) ?? available.get(trimmed) ?? available.get(stripWorldbookExtension(trimmed)) ?? null;
}

function stripWorldbookExtension(name: string): string {
  return name.replace(/\.json$/i, '');
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function matchesBookSourceFilter(name: string): boolean {
  const sources = bookSources.value[name] ?? [];
  if (bookSourceFilter.value === 'all') return true;
  if (bookSourceFilter.value === 'active') return sources.length > 0;
  if (bookSourceFilter.value === 'global') return sources.includes('global');
  if (bookSourceFilter.value === 'character') {
    return sources.includes('character_primary') || sources.includes('character_additional');
  }
  if (bookSourceFilter.value === 'chat') return sources.includes('chat');
  return sources.length === 0;
}

function bookSourceBadges(name: string): BookSourceBadge[] {
  const badgeMap: Record<BookSource, BookSourceBadge> = {
    chat: { value: 'chat', label: '聊天', title: '聊天世界书：只跟随当前聊天' },
    character_primary: {
      value: 'character_primary',
      label: '角色',
      title: '角色世界书：随角色绑定，导出角色时会随卡带走',
    },
    character_additional: {
      value: 'character_additional',
      label: '附加',
      title: '角色附加世界书：随角色绑定，但不是主世界书',
    },
    global: { value: 'global', label: '全局', title: '全局世界书：通过全局选择器启用' },
  };
  const order: Record<BookSource, number> = {
    chat: 0,
    character_primary: 1,
    character_additional: 2,
    global: 3,
  };
  return [...(bookSources.value[name] ?? [])]
    .sort((left, right) => order[left] - order[right])
    .map(source => badgeMap[source]);
}

function compareWorldbookNamesForDisplay(left: string, right: string): number {
  if (bookSortMode.value === 'selected') {
    const selectedDiff = selectedWorldbookSortRank(left) - selectedWorldbookSortRank(right);
    if (selectedDiff !== 0) return selectedDiff;
  }

  const pinned = worldbookDisplayRank(left) - worldbookDisplayRank(right);
  if (pinned !== 0) return pinned;

  const leftMeta = bookMetadata.value[left];
  const rightMeta = bookMetadata.value[right];
  const byNumberDesc = (leftValue: number | undefined, rightValue: number | undefined) => {
    const safeLeft = leftValue ?? -1;
    const safeRight = rightValue ?? -1;
    return safeRight - safeLeft;
  };
  const byName = left.localeCompare(right, 'zh-Hans-CN');

  switch (bookSortMode.value) {
    case 'name_asc':
      return byName;
    case 'name_desc':
      return -byName;
    case 'source': {
      const sourceDiff = worldbookSourceRank(left) - worldbookSourceRank(right);
      return sourceDiff || byName;
    }
    case 'entry_desc':
      return byNumberDesc(leftMeta?.entryCount, rightMeta?.entryCount) || byName;
    case 'token_desc':
      return byNumberDesc(leftMeta?.tokenEstimate, rightMeta?.tokenEstimate) || byName;
    case 'dynamic_desc':
      return byNumberDesc(leftMeta?.dynamicCount, rightMeta?.dynamicCount) || byName;
    case 'default':
    default: {
      const sourceDiff = worldbookSourceRank(left) - worldbookSourceRank(right);
      return sourceDiff || byName;
    }
  }
}

function worldbookDisplayRank(name: string): number {
  if ((bookSources.value[name] ?? []).length > 0) return 0;
  return 1;
}

function selectedWorldbookSortRank(name: string): number {
  return selectedBookSortRank.value[name] ?? 1;
}

function worldbookSourceRank(name: string): number {
  const order: Record<BookSource, number> = {
    chat: 0,
    character_primary: 1,
    character_additional: 2,
    global: 3,
  };
  const sources = bookSources.value[name] ?? [];
  return sources.length === 0 ? 99 : Math.min(...sources.map(source => order[source]));
}

function findPreviewAnchorElement(anchorKey: string): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const element of document.querySelectorAll<HTMLElement>('[data-wbm-preview-key]')) {
    if (element.dataset.wbmPreviewKey !== anchorKey) continue;
    fallback ??= element;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return element;
  }
  return fallback;
}

function findScrollableAncestor(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollY && current.scrollHeight > current.clientHeight + 1) return current;
    current = current.parentElement;
  }
  return null;
}

function captureScrollSnapshot(anchorKey?: string): ScrollSnapshot {
  const elements = new Map<HTMLElement, { element: HTMLElement; left: number; top: number }>();
  const addElement = (element: Element | null): void => {
    if (!(element instanceof HTMLElement)) return;
    elements.set(element, { element, left: element.scrollLeft, top: element.scrollTop });
  };
  const addScrollAncestors = (element: HTMLElement | null): void => {
    let current = element;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      if (/(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)) addElement(current);
      current = current.parentElement;
    }
  };

  document
    .querySelectorAll('.wbm-overlay, .wbm-dialog, .wbm-preview, .wbm-table-wrap, .wbm-card-list')
    .forEach(addElement);

  let activeElement = document.activeElement;
  while (activeElement instanceof HTMLElement) {
    addElement(activeElement);
    activeElement = activeElement.parentElement;
  }
  const activePreviewElement =
    document.activeElement instanceof HTMLElement
      ? (document.activeElement.closest('[data-wbm-preview-key]') as HTMLElement | null)
      : null;
  const anchorElement = anchorKey ? findPreviewAnchorElement(anchorKey) : activePreviewElement;
  addElement(anchorElement);
  addScrollAncestors(anchorElement);
  const scroller = findScrollableAncestor(anchorElement);
  const anchorTop = anchorElement
    ? anchorElement.getBoundingClientRect().top - (scroller ? scroller.getBoundingClientRect().top : 0)
    : 0;

  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    elements: [...elements.values()],
    anchor: anchorElement
      ? { key: anchorElement.dataset.wbmPreviewKey ?? anchorKey ?? '', top: anchorTop, scroller }
      : null,
  };
}

function restoreScrollAnchor(anchor: ScrollAnchor | null): void {
  if (!anchor?.key) return;
  const anchorElement = findPreviewAnchorElement(anchor.key);
  if (!anchorElement) return;
  const scroller =
    anchor.scroller && document.documentElement.contains(anchor.scroller)
      ? anchor.scroller
      : findScrollableAncestor(anchorElement);
  const currentTop = anchorElement.getBoundingClientRect().top - (scroller ? scroller.getBoundingClientRect().top : 0);
  const delta = currentTop - anchor.top;
  if (Math.abs(delta) < 1) return;
  if (scroller) {
    scroller.scrollTop += delta;
  } else {
    window.scrollBy(0, delta);
  }
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot): void {
  window.scrollTo(snapshot.windowX, snapshot.windowY);
  snapshot.elements.forEach(({ element, left, top }) => {
    if (!document.documentElement.contains(element)) return;
    element.scrollLeft = left;
    element.scrollTop = top;
  });
  restoreScrollAnchor(snapshot.anchor);
}

function scheduleScrollRestore(snapshot: ScrollSnapshot): void {
  restoreScrollSnapshot(snapshot);
  requestAnimationFrame(() => {
    restoreScrollSnapshot(snapshot);
    requestAnimationFrame(() => restoreScrollSnapshot(snapshot));
  });
  window.setTimeout(() => restoreScrollSnapshot(snapshot), 0);
  window.setTimeout(() => restoreScrollSnapshot(snapshot), 80);
  window.setTimeout(() => restoreScrollSnapshot(snapshot), 220);
  window.setTimeout(() => restoreScrollSnapshot(snapshot), 500);
}

function bookMetadataLabel(name: string): string {
  const metadata = bookMetadata.value[name];
  if (!metadata) return metadataProgress.running ? '计算中...' : '';
  if (metadata.errorMessage) return '读取失败';
  return `${metadata.entryCount} 条 · Token≈${metadata.tokenEstimate} · 动态 ${metadata.dynamicCount}`;
}

function pruneBookMetadata(names: string[]): void {
  const available = new Set(names);
  const next: Record<string, BookMetadata> = {};
  for (const [name, metadata] of Object.entries(bookMetadata.value)) {
    if (available.has(name)) next[name] = metadata;
  }
  bookMetadata.value = next;
}

async function loadBookMetadataInBackground(names: string[]): Promise<void> {
  const runId = ++metadataRunId;
  const pending = names.filter(name => !bookMetadata.value[name]);
  metadataProgress.loaded = 0;
  metadataProgress.total = pending.length;
  metadataProgress.running = pending.length > 0;
  for (const name of pending) {
    if (runId !== metadataRunId) return;
    try {
      const entries = await getWorldbook(name);
      const metadata = createBookMetadata(entries);
      bookMetadata.value = { ...bookMetadata.value, [name]: metadata };
    } catch (error) {
      bookMetadata.value = {
        ...bookMetadata.value,
        [name]: {
          entryCount: 0,
          enabledCount: 0,
          tokenEstimate: 0,
          dynamicCount: 0,
          loadedAt: Date.now(),
          errorMessage: formatError(error),
        },
      };
    } finally {
      if (runId === metadataRunId) metadataProgress.loaded += 1;
    }
  }
  if (runId === metadataRunId) metadataProgress.running = false;
}

function createBookMetadata(entries: WorldbookEntry[]): BookMetadata {
  return {
    entryCount: entries.length,
    enabledCount: entries.filter(entry => entry.enabled).length,
    tokenEstimate: entries.reduce((sum, entry) => sum + estimateTokenCount(entry.content), 0),
    dynamicCount: entries.filter(entry => detectEntryRisks(entry).some(risk => risk.level !== 'warning')).length,
    loadedAt: Date.now(),
    errorMessage: null,
  };
}

function clearSelectedBooks(): void {
  selectedBooks.value = new Set();
  previewRows.value = [];
  expandedPreviewIds.value = new Set();
  editingContentIds.value = new Set();
  entryActionOverrides.value = {};
  customEntryOverrides.value = {};
  contentEditOverrides.value = {};
  contentEditDrafts.value = {};
  closeCustomEditor();
  resetDedupeState();
}

function toggleBook(name: string): void {
  const next = new Set(selectedBooks.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  selectedBooks.value = next;
  previewRows.value = [];
  expandedPreviewIds.value = new Set();
  editingContentIds.value = new Set();
  entryActionOverrides.value = {};
  customEntryOverrides.value = {};
  contentEditOverrides.value = {};
  contentEditDrafts.value = {};
  closeCustomEditor();
  resetDedupeState();
}

function resetPreviewManualState(): void {
  entryActionOverrides.value = {};
  customEntryOverrides.value = {};
  contentEditOverrides.value = {};
  contentEditDrafts.value = {};
  editingContentIds.value = new Set();
  closeCustomEditor();
}

function resetDedupeState(): void {
  dedupeGroups.value = [];
  dedupeSelectedGroupIds.value = new Set();
  dedupeKeepOverrides.value = {};
  dedupeApplyResults.value = [];
  characterWorldbookBindings.value = [];
  dedupeConfirmState.open = false;
  dedupeConfirmState.characterRebindCount = 0;
}

async function generateDefaultPreview(): Promise<void> {
  resetPreviewManualState();
  await generatePreview();
}

async function generateDedupePreview(): Promise<void> {
  if (!canGenerateDedupePreview.value) return;
  isBusy.value = true;
  dedupeGroups.value = [];
  dedupeSelectedGroupIds.value = new Set();
  dedupeKeepOverrides.value = {};
  dedupeApplyResults.value = [];
  const snapshots: DuplicateWorldbookSnapshot[] = [];
  const failures: string[] = [];

  try {
    for (const bookName of selectedBooks.value) {
      try {
        const entries = await getWorldbook(bookName);
        const originalData = await loadOriginalWorldbookData(bookName).catch(() => ({}));
        snapshots.push({
          name: bookName,
          entries,
          importedAt: extractWorldbookTimestamp(originalData, ['importedAt', 'createdAt', 'createDate', 'dateAdded']),
          modifiedAt: extractWorldbookTimestamp(originalData, ['modifiedAt', 'updatedAt', 'updateDate', 'lastModified']),
          loadedAt: Date.now(),
        });
      } catch (error) {
        failures.push(`${bookName}: ${formatError(error)}`);
      }
    }

    characterWorldbookBindings.value = await collectAllCharacterWorldbookBindings();
    const plan = createDuplicateWorldbookPlan(snapshots, toDedupeSourceMap(bookSources.value), {
      keepPriority: 'latest_version',
      strategy: dedupeStrategy.value,
    });
    dedupeGroups.value = plan.groups;
    dedupeSelectedGroupIds.value = new Set(plan.groups.filter(group => group.defaultSelected).map(group => group.id));

    if (failures.length > 0) {
      notifyError(`部分世界书读取失败：${failures.slice(0, 3).join('；')}`);
    }
    if (plan.groups.length === 0) {
      notifyInfo('没有发现可处理的世界书重复候选。');
    }
  } finally {
    isBusy.value = false;
  }
}

function toDedupeSourceMap(sources: Record<string, BookSource[]>): Record<string, DuplicateWorldbookSource[]> {
  return Object.fromEntries(
    Object.entries(sources).map(([name, sourceList]) => [
      name,
      sourceList.map(source => source as DuplicateWorldbookSource),
    ]),
  );
}

function extractWorldbookTimestamp(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return null;
}

function isDedupeGroupSelected(groupId: string): boolean {
  return dedupeSelectedGroupIds.value.has(groupId);
}

function toggleDedupeGroup(groupId: string): void {
  const next = new Set(dedupeSelectedGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  dedupeSelectedGroupIds.value = next;
}

function dedupeKeepName(group: DuplicateWorldbookGroup): string {
  const override = dedupeKeepOverrides.value[group.id];
  if (override && group.candidates.some(candidate => candidate.name === override)) return override;
  return group.keepCandidate.name;
}

function setDedupeKeepCandidate(group: DuplicateWorldbookGroup, event: Event): void {
  const keepName = (event.target as HTMLSelectElement).value;
  dedupeKeepOverrides.value = { ...dedupeKeepOverrides.value, [group.id]: keepName };
  const nextSelected = new Set(dedupeSelectedGroupIds.value);
  nextSelected.add(group.id);
  dedupeSelectedGroupIds.value = nextSelected;
}

function dedupeDeleteCandidates(group: DuplicateWorldbookGroup): DuplicateWorldbookCandidate[] {
  const keepName = dedupeKeepName(group);
  return group.candidates.filter(candidate => candidate.name !== keepName);
}

function dedupeDeleteSummary(group: DuplicateWorldbookGroup): string {
  const deleteCount = dedupeDeleteCandidates(group).length;
  if (!isDedupeGroupSelected(group.id)) return `已跳过 · ${deleteCount} 本不会删除`;
  return `将删除 ${deleteCount} 本旧版本`;
}

function dedupeGroupCharacterRebindCount(group: DuplicateWorldbookGroup): number {
  const deleted = new Set(dedupeDeleteCandidates(group).map(candidate => candidate.name));
  if (deleted.size === 0) return 0;
  return characterWorldbookBindings.value.filter(binding => binding.worldbook && deleted.has(binding.worldbook)).length;
}

function dedupeConfidenceLabel(confidence: DuplicateWorldbookGroup['confidence']): string {
  const labels: Record<DuplicateWorldbookGroup['confidence'], string> = {
    exact: '完全重复',
    high: '高置信',
    medium: '中置信',
    low: '低置信',
  };
  return labels[confidence];
}

function dedupeCandidateVersionLabel(candidate: DuplicateWorldbookCandidate): string {
  const version = candidate.versionInfo.versionLabel ?? '未识别版本';
  const copy = candidate.versionInfo.isCopy ? ' · 副本' : '';
  const source = dedupeSourcesLabel(candidate.sources);
  return `${version}${copy}${source ? ` · ${source}` : ''}`;
}

function dedupeCandidateMeta(candidate: DuplicateWorldbookCandidate): string {
  const fingerprint = candidate.fingerprint;
  return `${fingerprint.entryCount} 条 · 启用 ${fingerprint.enabledEntryCount} 条 · Token≈${formatTokenCount(fingerprint.tokenEstimate)}`;
}

function dedupeCandidateSimilarityLabel(
  group: DuplicateWorldbookGroup,
  candidate: DuplicateWorldbookCandidate,
): string {
  if (candidate.name === dedupeKeepName(group)) return '保留版本';
  return `内容覆盖 ${formatPercent(candidate.contentCoverageByKeep)} · 整书相似 ${formatPercent(
    candidate.textSimilarityToKeep,
  )} · 匹配 ${candidate.matchedEntryCountToKeep} 条`;
}

function dedupeSourcesLabel(sources: DuplicateWorldbookSource[]): string {
  return sources.map(dedupeSourceLabel).join(' / ');
}

function dedupeSourceLabel(source: DuplicateWorldbookSource): string {
  const labels: Record<DuplicateWorldbookSource, string> = {
    chat: '聊天',
    character_primary: '角色',
    character_additional: '附加',
    character_all: '角色卡',
    global: '全局',
  };
  return labels[source];
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function confirmDedupeApply(): void {
  if (!canApplyDedupe.value) return;
  dedupeConfirmState.groupCount = dedupeSelectedGroups.value.length;
  dedupeConfirmState.deleteCount = dedupeSelectedDeleteCount.value;
  dedupeConfirmState.rebindCount = dedupeSelectedRebindCount.value;
  dedupeConfirmState.characterRebindCount = dedupeSelectedCharacterRebindCount.value;
  closeTransientModals();
  dedupeConfirmState.open = true;
  scheduleModalViewportSync();
}

function cancelDedupeConfirm(): void {
  dedupeConfirmState.open = false;
}

async function applyDedupeChanges(): Promise<void> {
  if (!canApplyDedupe.value) return;
  dedupeConfirmState.open = false;
  isBusy.value = true;
  const results: DuplicateApplyResult[] = [];

  try {
    for (const group of dedupeSelectedGroups.value) {
      const keepName = dedupeKeepName(group);
      const deleteNames = dedupeDeleteCandidates(group).map(candidate => candidate.name);
      let reboundSources: DuplicateWorldbookSource[] = [];

      try {
        reboundSources = await rebindWorldbookReferences(deleteNames, keepName);
      } catch (error) {
        results.push(
          ...deleteNames.map(worldbook => ({
            groupId: group.id,
            keepName,
            worldbook,
            reboundSources: [],
            failed: true,
            errorMessage: `重绑失败：${formatError(error)}`,
          })),
        );
        continue;
      }

      for (const worldbook of deleteNames) {
        try {
          const deleted = await deleteWorldbook(worldbook);
          if (!deleted) throw new Error('删除接口返回失败');
          results.push({
            groupId: group.id,
            keepName,
            worldbook,
            reboundSources,
            failed: false,
            errorMessage: null,
          });
        } catch (error) {
          results.push({
            groupId: group.id,
            keepName,
            worldbook,
            reboundSources,
            failed: true,
            errorMessage: formatError(error),
          });
        }
      }
    }
  } finally {
    isBusy.value = false;
  }

  dedupeApplyResults.value = results;
  dedupeGroups.value = [];
  dedupeSelectedGroupIds.value = new Set();
  dedupeKeepOverrides.value = {};
  selectionInitialized.value = false;
  await loadWorldbooksForDedupe({ resetDedupe: false });

  const failed = results.filter(result => result.failed).length;
  const deleted = results.length - failed;
  if (failed > 0) {
    notifyError(`去重完成，但有 ${failed} 本失败；已删除 ${deleted} 本。`);
  } else {
    notifySuccess(`去重完成，已删除 ${deleted} 本旧版本。`);
  }
}

async function rebindWorldbookReferences(deleteNames: string[], keepName: string): Promise<DuplicateWorldbookSource[]> {
  const allCharacterWorldbooks =
    characterWorldbookBindings.value.length > 0
      ? characterWorldbookBindings.value
      : await collectAllCharacterWorldbookBindings();
  const bindings = {
    globalNames: typeof getGlobalWorldbookNames === 'function' ? getGlobalWorldbookNames() : undefined,
    charWorldbooks: typeof getCharWorldbookNames === 'function' ? getCharWorldbookNames('current') : undefined,
    chatName: typeof getChatWorldbookName === 'function' ? getChatWorldbookName('current') : undefined,
    allCharacterWorldbooks,
  };
  const plan = createDuplicateWorldbookRebindPlan(deleteNames, keepName, bindings);

  if (plan.globalNames) {
    if (typeof rebindGlobalWorldbooks !== 'function') throw new Error('全局世界书重绑 API 不可用');
    await rebindGlobalWorldbooks(plan.globalNames);
  }

  if (plan.charWorldbooks) {
    if (typeof rebindCharWorldbooks !== 'function') throw new Error('角色世界书重绑 API 不可用');
    await rebindCharWorldbooks('current', plan.charWorldbooks);
  }

  if (plan.chatName) {
    if (typeof rebindChatWorldbook !== 'function') throw new Error('聊天世界书重绑 API 不可用');
    await rebindChatWorldbook('current', plan.chatName);
  }

  if (plan.characterUpdates && plan.characterUpdates.length > 0) {
    if (typeof updateCharacterWith !== 'function') throw new Error('角色卡主世界书重绑 API 不可用');
    const deleted = new Set(deleteNames);
    for (const update of plan.characterUpdates) {
      await updateCharacterWith(update.characterName, character => {
        if (deleted.has(character.worldbook ?? '')) {
          character.worldbook = keepName;
        }
        return character;
      });
    }
  }

  return plan.sources;
}

async function generatePreview(options: GeneratePreviewOptions = {}): Promise<void> {
  if (!canPreview.value) return;
  const scrollSnapshot =
    options.scrollSnapshot ?? (options.preserveScroll ? captureScrollSnapshot(options.anchorKey) : null);
  isBusy.value = true;
  isPreviewCollapsed.value = false;
  const editingKeys = new Set(editingContentIds.value);
  if (!options.keepRowsUntilReady) {
    previewRows.value = [];
    expandedPreviewIds.value = new Set();
  }
  if (!options.preserveScroll) applyResults.value = [];
  const rows: PreviewChange[] = [];
  try {
    for (const bookName of optimizerTargetWorldbookNames.value) {
      try {
        const entries = await getWorldbook(bookName);
        if (entries.length === 0) {
          rows.push(createFailedRow(bookName, '世界书为空'));
          continue;
        }
        const plan = isPromptBuildSpeedMode.value
          ? buildPromptBuildSpeedBookPlan(bookName, entries)
          : buildBookPlan(bookName, entries, true, {
              includeDisabledEntries: includeDisabledEntriesForCache.value,
            });
        rows.push(...plan.rows);
      } catch (error) {
        rows.push(createFailedRow(bookName, formatError(error)));
      }
    }
    rows.forEach((row, index) => {
      row.previewIndex = index;
    });
    const rowsWithTokens = await hydrateTokenCounts(rows);
    previewRows.value = rowsWithTokens;
    expandedPreviewIds.value = new Set(
      rowsWithTokens.filter(row => editingKeys.has(row.contentEditKey)).map(row => row.id),
    );
    if (rows.every(row => row.status !== 'changed')) {
      notifyInfo(
        isPromptBuildSpeedMode.value
          ? '合并方案已生成，没有可安全合并的蓝灯条目。'
          : '修改意见已生成，没有建议修改的条目。',
      );
    }
  } finally {
    isBusy.value = false;
    await nextTick();
    if (scrollSnapshot) scheduleScrollRestore(scrollSnapshot);
  }
}

function confirmApply(): void {
  const changedRows = previewRows.value.filter(row => row.changed);
  if (changedRows.length === 0) return;
  confirmState.bookCount = new Set(changedRows.map(row => row.worldbook)).size;
  confirmState.changeCount = changedRows.length;
  confirmState.doNotShowAgain = false;
  closeTransientModals();
  if (applyWarningDismissed.value) {
    void continueAfterBackupWarning();
    return;
  }
  confirmState.open = true;
  scheduleModalViewportSync();
}

function cancelConfirm(): void {
  confirmState.open = false;
}

function cancelBlueTokenWarning(): void {
  blueTokenWarningState.open = false;
}

function openStructureModal(): void {
  if (previewRows.value.length === 0) return;
  structureHighlightSource.value = null;
  structureGraphMode.value = previewRows.value.some(row => row.changed) ? 'changed' : 'all';
  structureState.open = true;
}

function closeStructureModal(): void {
  structureState.open = false;
  structureHighlightSource.value = null;
}

function setStructureGraphMode(mode: StructureGraphMode): void {
  structureGraphMode.value = mode;
  structureHighlightSource.value = null;
}

function setOptimizerMode(mode: OptimizerMode): void {
  if (optimizerMode.value === mode) return;
  optimizerMode.value = mode;
  previewRows.value = [];
  applyResults.value = [];
  previewFilter.value = 'changed';
  structureState.open = false;
  structureHighlightSource.value = null;
  resetPreviewManualState();
}

function setDedupeStrategy(strategy: DuplicateWorldbookStrategy): void {
  if (dedupeStrategy.value === strategy) return;
  dedupeStrategy.value = strategy;
  resetDedupeState();
}

function setStructureHighlight(key: string): void {
  structureHighlightSource.value = key;
}

function clearStructureHighlight(): void {
  structureHighlightSource.value = null;
}

function toggleStructureHighlight(key: string): void {
  structureHighlightSource.value = structureHighlightSource.value === key ? null : key;
}

function openRuleHelp(): void {
  closeTransientModals();
  ruleHelpOpen.value = true;
  scheduleModalViewportSync();
}

function closeRuleHelp(): void {
  ruleHelpOpen.value = false;
}

function closeTransientModals(): void {
  ruleHelpOpen.value = false;
  optimizerSettingsOpen.value = false;
  confirmState.open = false;
  blueTokenWarningState.open = false;
  dedupeConfirmState.open = false;
  customEditorState.open = false;
  closeVersionManager();
}

function scheduleModalViewportSync(): void {
  void nextTick(() => {
    syncModalViewport();
  });
}

function syncModalViewport(): void {
  const rootElement = managerRootElement.value;
  const dialogElement = rootElement?.querySelector<HTMLElement>('.wbm-dialog') ?? null;
  const hostElement = dialogElement ?? rootElement;
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

  getConfirmModalElements().forEach(modal => {
    const isMobileRuleHelp = isMobileViewport && modal.classList.contains('wbm-rule-help-modal');
    modal.style.setProperty('position', 'absolute', 'important');
    modal.style.setProperty('top', `${viewportTop}px`, 'important');
    modal.style.setProperty('left', '0', 'important');
    modal.style.setProperty('right', 'auto', 'important');
    modal.style.setProperty('bottom', 'auto', 'important');
    modal.style.setProperty('width', `${viewportWidth}px`, 'important');
    modal.style.setProperty('height', `${viewportHeight}px`, 'important');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('align-items', isMobileRuleHelp ? 'stretch' : 'center', 'important');
    modal.style.setProperty('justify-content', 'center', 'important');
    modal.style.setProperty('box-sizing', 'border-box', 'important');
    modal.style.setProperty('z-index', '31400', 'important');
    if (isMobileRuleHelp) {
      modal.style.setProperty('padding', '0', 'important');
    }
  });
}

function getConfirmModalElements(): HTMLElement[] {
  const rootElement = managerRootElement.value;
  return rootElement ? Array.from(rootElement.querySelectorAll<HTMLElement>('.wbm-confirm')) : [];
}

async function applyChanges(): Promise<void> {
  if (!canApply.value) return;
  if (confirmState.doNotShowAgain) {
    persistApplyWarningDismissed();
  }
  confirmState.open = false;
  await continueAfterBackupWarning();
}

async function continueAfterBackupWarning(): Promise<void> {
  if (!canApply.value) return;
  if (postApplyBlueTokenStats.value.isOverThreshold && !blueTokenWarningDismissed.value) {
    blueTokenWarningState.doNotShowAgain = false;
    blueTokenWarningState.open = true;
    scheduleModalViewportSync();
    return;
  }
  await applyChangesDirect();
}

async function confirmBlueTokenWarning(): Promise<void> {
  if (!canApply.value) return;
  if (blueTokenWarningState.doNotShowAgain) {
    persistBlueTokenWarningDismissed();
  }
  blueTokenWarningState.open = false;
  await applyChangesDirect();
}

async function applyChangesDirect(): Promise<void> {
  isBusy.value = true;
  applyResults.value = [];
  const results: ApplyResult[] = [];
  let mergeReducedCount = 0;
  try {
    for (const bookName of optimizerTargetWorldbookNames.value) {
      try {
        const entries = await getWorldbook(bookName);
        const plan = isPromptBuildSpeedMode.value
          ? buildPromptBuildSpeedBookPlan(bookName, entries)
          : buildBookPlan(bookName, entries, false, {
              includeDisabledEntries: includeDisabledEntriesForCache.value,
            });
        const changedCount = plan.changedCount;
        if (changedCount > 0) {
          if (isPromptBuildSpeedMode.value) {
            mergeReducedCount += plan.rows.reduce((sum, row) => sum + Math.max(0, (row.mergeSourceCount ?? 1) - 1), 0);
          }
          await saveWorldbookImmediately(bookName, plan.entries);
          refreshWorldbookEditor(bookName);
        }
        results.push({ worldbook: bookName, changed: changedCount, failed: false, errorMessage: null });
      } catch (error) {
        results.push({ worldbook: bookName, changed: 0, failed: true, errorMessage: formatError(error) });
      }
    }
    applyResults.value = results;
    const changed = results.reduce((sum, item) => sum + item.changed, 0);
    const failed = results.filter(item => item.failed).length;
    if (failed === 0) {
      entryActionOverrides.value = {};
      customEntryOverrides.value = {};
      contentEditOverrides.value = {};
      editingContentIds.value = new Set();
      contentEditDrafts.value = {};
      closeCustomEditor();
    }
    await generatePreview();
    if (failed > 0) {
      notifyError(
        isPromptBuildSpeedMode.value
          ? `应用完成，但有 ${failed} 本世界书失败；已合并 ${changed} 组，净减少 ${mergeReducedCount} 条蓝灯。`
          : `应用完成，但有 ${failed} 本世界书失败；已修改 ${changed} 个条目。`,
      );
    } else {
      notifySuccess(
        isPromptBuildSpeedMode.value
          ? `应用完成，已合并 ${changed} 组，净减少 ${mergeReducedCount} 条蓝灯。`
          : `应用完成，已修改 ${changed} 个条目。`,
      );
    }
  } finally {
    isBusy.value = false;
  }
}

async function saveWorldbookImmediately(bookName: string, entries: WorldbookEntry[]): Promise<void> {
  const context = getSillyTavernContext();
  if (!context || typeof context.saveWorldInfo !== 'function') {
    throw new Error('SillyTavern 原生世界书保存接口不可用');
  }

  const originalData = await loadOriginalWorldbookData(bookName);
  await context.saveWorldInfo(
    bookName,
    {
      ...originalData,
      entries: toOriginalWorldbookEntries(entries),
    },
    true,
  );
  await verifyWorldbookSaved(bookName, entries);
}

function getSillyTavernContext(): typeof SillyTavern | null {
  return typeof SillyTavern === 'undefined' ? null : SillyTavern;
}

async function loadOriginalWorldbookData(bookName: string): Promise<Record<string, unknown>> {
  const context = getSillyTavernContext();
  if (!context || typeof context.loadWorldInfo !== 'function') return {};
  const data = await context.loadWorldInfo(bookName);
  return isRecord(data) ? data : {};
}

function toOriginalWorldbookEntries(entries: WorldbookEntry[]): Record<string, OriginalWorldbookEntry> {
  return Object.fromEntries(entries.map((entry, index) => [String(entry.uid), toOriginalWorldbookEntry(entry, index)]));
}

function toOriginalWorldbookEntry(entry: WorldbookEntry, displayIndex: number): OriginalWorldbookEntry {
  const source = entry as WorldbookEntryWithImplicit;
  const result: OriginalWorldbookEntry = {
    ...resolveWorldbookImplicitFields(source),
    uid: entry.uid,
    displayIndex,
    comment: entry.name ?? '',
    disable: !entry.enabled,
    constant: entry.strategy.type === 'constant',
    selective: entry.strategy.type === 'selective',
    key: entry.strategy.keys.map(formatWorldbookKey),
    selectiveLogic: SELECTIVE_LOGIC_TO_ORIGINAL[entry.strategy.keys_secondary.logic],
    keysecondary: entry.strategy.keys_secondary.keys.map(formatWorldbookKey),
    scanDepth: entry.strategy.scan_depth === 'same_as_global' ? null : entry.strategy.scan_depth,
    vectorized: entry.strategy.type === 'vectorized',
    position: POSITION_TO_ORIGINAL[entry.position.type],
    role: ROLE_TO_ORIGINAL[entry.position.role],
    depth: entry.position.depth,
    order: entry.position.order,
    content: entry.content,
    useProbability: true,
    probability: entry.probability,
    excludeRecursion: entry.recursion.prevent_incoming,
    preventRecursion: entry.recursion.prevent_outgoing,
    delayUntilRecursion: entry.recursion.delay_until ?? false,
    sticky: entry.effect.sticky,
    cooldown: entry.effect.cooldown,
    delay: entry.effect.delay,
  };
  if (entry.extra) {
    result.extra = { ...entry.extra };
  }
  return result;
}

function resolveWorldbookImplicitFields(entry: WorldbookEntryWithImplicit): WorldbookImplicitFields {
  return {
    addMemo: entry.addMemo ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.addMemo,
    matchPersonaDescription: entry.matchPersonaDescription ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchPersonaDescription,
    matchCharacterDescription:
      entry.matchCharacterDescription ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchCharacterDescription,
    matchCharacterPersonality:
      entry.matchCharacterPersonality ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchCharacterPersonality,
    matchCharacterDepthPrompt:
      entry.matchCharacterDepthPrompt ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchCharacterDepthPrompt,
    matchScenario: entry.matchScenario ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchScenario,
    matchCreatorNotes: entry.matchCreatorNotes ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchCreatorNotes,
    group: entry.group ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.group,
    groupOverride: entry.groupOverride ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.groupOverride,
    groupWeight: entry.groupWeight ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.groupWeight,
    caseSensitive: entry.caseSensitive ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.caseSensitive,
    matchWholeWords: entry.matchWholeWords ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.matchWholeWords,
    useGroupScoring: entry.useGroupScoring ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.useGroupScoring,
    automationId: entry.automationId ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.automationId,
    ignoreBudget: entry.ignoreBudget ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.ignoreBudget,
    outletName: entry.outletName ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.outletName,
    triggers: [...(entry.triggers ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.triggers)],
    characterFilter: {
      isExclude: entry.characterFilter?.isExclude ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.characterFilter.isExclude,
      names: [...(entry.characterFilter?.names ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.characterFilter.names)],
      tags: [...(entry.characterFilter?.tags ?? DEFAULT_WORLDBOOK_IMPLICIT_FIELDS.characterFilter.tags)],
    },
  };
}

function formatWorldbookKey(key: string | RegExp): string {
  return String(key);
}

async function verifyWorldbookSaved(bookName: string, expectedEntries: WorldbookEntry[]): Promise<void> {
  const savedEntries = await getWorldbook(bookName);
  const isSame =
    savedEntries.length === expectedEntries.length &&
    savedEntries.every(
      (entry, index) => entry.uid === expectedEntries[index].uid && sameManagedEntry(entry, expectedEntries[index]),
    );
  if (!isSame) {
    throw new Error('世界书保存后复读校验失败，已阻止继续报告成功');
  }
}

function refreshWorldbookEditor(bookName: string): void {
  const context = getSillyTavernContext();
  if (!context || typeof context.reloadWorldInfoEditor !== 'function') return;
  try {
    context.reloadWorldInfoEditor(bookName, true);
  } catch (error) {
    console.warn(`[世界书缓存优化器] 刷新世界书编辑器失败：${formatError(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readApplyWarningDismissed(): boolean {
  if (typeof getVariables !== 'function') return false;
  try {
    return getVariables({ type: 'script' })[APPLY_WARNING_DISMISSED_KEY] === true;
  } catch (error) {
    console.warn(`[世界书缓存优化器] 读取应用提醒设置失败：${formatError(error)}`);
    return false;
  }
}

function persistApplyWarningDismissed(): void {
  applyWarningDismissed.value = true;
  if (typeof updateVariablesWith !== 'function') return;
  try {
    updateVariablesWith(variables => ({ ...variables, [APPLY_WARNING_DISMISSED_KEY]: true }), { type: 'script' });
  } catch (error) {
    console.warn(`[世界书缓存优化器] 保存应用提醒设置失败：${formatError(error)}`);
  }
}

function readBlueTokenWarningDismissed(): boolean {
  if (typeof getVariables !== 'function') return false;
  try {
    return getVariables({ type: 'script' })[BLUE_TOKEN_WARNING_DISMISSED_KEY] === true;
  } catch (error) {
    console.warn(`[世界书缓存优化器] 读取蓝灯 Token 提醒设置失败：${formatError(error)}`);
    return false;
  }
}

function readVersionImportSourcePreference(): {
  sourceId: VersionImportSourceSelection;
  customTemplate: string;
} {
  if (typeof getVariables !== 'function') {
    return { sourceId: 'jsdelivr', customTemplate: DEFAULT_VERSION_IMPORT_TEMPLATE };
  }
  try {
    const raw = getVariables({ type: 'script' })[VERSION_IMPORT_SOURCE_PREF_KEY];
    if (!isRecord(raw)) return { sourceId: 'jsdelivr', customTemplate: DEFAULT_VERSION_IMPORT_TEMPLATE };
    const rawSourceId = raw.sourceId;
    const sourceId =
      rawSourceId === CUSTOM_VERSION_IMPORT_SOURCE_ID || VERSION_IMPORT_SOURCES.some(source => source.id === rawSourceId)
        ? (rawSourceId as VersionImportSourceSelection)
        : 'jsdelivr';
    const customTemplate =
      typeof raw.customTemplate === 'string' && raw.customTemplate.trim()
        ? raw.customTemplate
        : DEFAULT_VERSION_IMPORT_TEMPLATE;
    return { sourceId, customTemplate };
  } catch (error) {
    console.warn(`[世界书缓存优化器] 读取版本分发源失败：${formatError(error)}`);
    return { sourceId: 'jsdelivr', customTemplate: DEFAULT_VERSION_IMPORT_TEMPLATE };
  }
}

function readOptimizerFilterPreference(): OptimizerFilterPreference {
  const fallback: OptimizerFilterPreference = {
    optimizerMode: 'cache',
    bookSourceFilter: 'all',
    previewFilter: 'changed',
    previewSortMode: 'custom',
    cacheEntryScope: 'enabled',
    defaultWorldbookSelection: 'active',
    dedupeStrategy: 'balanced',
  };
  try {
    const raw = window.localStorage?.getItem(OPTIMIZER_FILTER_PREF_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (!isRecord(value)) return fallback;
    const cacheEntryScope =
      isCacheEntryScope(value.cacheEntryScope)
        ? value.cacheEntryScope
        : value.optimizeAllWorldbookEntries === true
          ? 'all'
          : fallback.cacheEntryScope;
    return {
      optimizerMode: isOptimizerMode(value.optimizerMode) ? value.optimizerMode : fallback.optimizerMode,
      bookSourceFilter: isBookSourceFilter(value.bookSourceFilter)
        ? value.bookSourceFilter
        : fallback.bookSourceFilter,
      previewFilter: isPreviewFilter(value.previewFilter) ? value.previewFilter : fallback.previewFilter,
      previewSortMode: isPreviewSortMode(value.previewSortMode) ? value.previewSortMode : fallback.previewSortMode,
      cacheEntryScope,
      defaultWorldbookSelection: isDefaultWorldbookSelection(value.defaultWorldbookSelection)
        ? value.defaultWorldbookSelection
        : fallback.defaultWorldbookSelection,
      dedupeStrategy: isDedupeStrategy(value.dedupeStrategy) ? value.dedupeStrategy : fallback.dedupeStrategy,
    };
  } catch (error) {
    console.warn(`[世界书缓存优化器] 读取过滤器偏好失败：${formatError(error)}`);
    return fallback;
  }
}

function persistOptimizerFilterPreference(): void {
  try {
    window.localStorage?.setItem(
      OPTIMIZER_FILTER_PREF_KEY,
      JSON.stringify({
        optimizerMode: optimizerMode.value,
        bookSourceFilter: bookSourceFilter.value,
        previewFilter: previewFilter.value,
        previewSortMode: previewSortMode.value,
        cacheEntryScope: cacheEntryScope.value,
        defaultWorldbookSelection: defaultWorldbookSelection.value,
        dedupeStrategy: dedupeStrategy.value,
      } satisfies OptimizerFilterPreference),
    );
  } catch (error) {
    console.warn(`[世界书缓存优化器] 保存过滤器偏好失败：${formatError(error)}`);
  }
}

function persistBlueTokenWarningDismissed(): void {
  blueTokenWarningDismissed.value = true;
  if (typeof updateVariablesWith !== 'function') return;
  try {
    updateVariablesWith(variables => ({ ...variables, [BLUE_TOKEN_WARNING_DISMISSED_KEY]: true }), { type: 'script' });
  } catch (error) {
    console.warn(`[世界书缓存优化器] 保存蓝灯 Token 提醒设置失败：${formatError(error)}`);
  }
}

function safeCall<T>(callback: () => T, fallback: T): T {
  try {
    return callback();
  } catch {
    return fallback;
  }
}

function isOptimizerMode(value: unknown): value is OptimizerMode {
  return value === 'cache' || value === 'prompt_build_speed';
}

function isCacheEntryScope(value: unknown): value is CacheEntryScope {
  return value === 'enabled' || value === 'all';
}

function isDefaultWorldbookSelection(value: unknown): value is DefaultWorldbookSelection {
  return value === 'active' || value === 'global' || value === 'character' || value === 'chat';
}

function isDedupeStrategy(value: unknown): value is DuplicateWorldbookStrategy {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive';
}

function isBookSourceFilter(value: unknown): value is BookSourceFilter {
  return ['all', 'active', 'global', 'character', 'chat', 'none'].includes(String(value));
}

function isPreviewFilter(value: unknown): value is PreviewFilter {
  return value === 'changed' || value === 'review' || value === 'all';
}

function isPreviewSortMode(value: unknown): value is PreviewSortMode {
  return [
    'custom',
    'title_asc',
    'title_desc',
    'token_asc',
    'token_desc',
    'depth_asc',
    'depth_desc',
    'order_asc',
    'order_desc',
    'uid_asc',
    'uid_desc',
    'probability_asc',
    'probability_desc',
    'priority_asc',
    'priority_desc',
  ].includes(String(value));
}

function syncVisualViewportHeight(): void {
  const height =
    window.visualViewport?.height ||
    window.innerHeight ||
    document.documentElement.clientHeight ||
    document.body.clientHeight ||
    640;
  document.documentElement.style.setProperty(VISUAL_VIEWPORT_CSS_VAR, `${Math.max(320, Math.round(height))}px`);
  if (
    ruleHelpOpen.value ||
    confirmState.open ||
    blueTokenWarningState.open ||
    dedupeConfirmState.open ||
    customEditorState.open
  ) {
    scheduleModalViewportSync();
  }
}

async function hydrateTokenCounts(rows: PreviewChange[]): Promise<PreviewChange[]> {
  const counter = await getTokenCounter();
  return Promise.all(
    rows.map(async row => {
      if (!row.content) return { ...row, tokenCount: 0, tokenIsEstimated: counter === null };
      if (!counter) {
        return { ...row, tokenCount: estimateTokenCount(row.content), tokenIsEstimated: true };
      }
      try {
        return { ...row, tokenCount: await counter(row.content), tokenIsEstimated: false };
      } catch {
        return { ...row, tokenCount: estimateTokenCount(row.content), tokenIsEstimated: true };
      }
    }),
  );
}

async function getTokenCounter(): Promise<TokenCounter | null> {
  tokenCounterPromise ??= resolveTokenCounter();
  return tokenCounterPromise;
}

async function resolveTokenCounter(): Promise<TokenCounter | null> {
  const context = safeCall(() => {
    const tavern = (window as unknown as { SillyTavern?: { getContext?: () => unknown } }).SillyTavern;
    return tavern?.getContext?.() ?? null;
  }, null);

  const contextCounter = findTokenCounter(context);
  if (contextCounter) return contextCounter;

  const windowCounter = findTokenCounter(window);
  if (windowCounter) return windowCounter;

  try {
    // eslint-disable-next-line import-x/no-unresolved -- SillyTavern serves this host runtime module.
    const tokenizerModule = (await import(/* webpackIgnore: true */ '/scripts/tokenizers.js')) as Record<
      string,
      unknown
    >;
    return findTokenCounter(tokenizerModule);
  } catch {
    return null;
  }
}

function findTokenCounter(source: unknown): TokenCounter | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  const candidate = record.getTokenCountAsync ?? record.getTokenCount;
  if (typeof candidate !== 'function') return null;
  return async (text: string) => normalizeTokenCount(await candidate.call(source, text));
}

function normalizeTokenCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.ceil(value));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['token_count', 'tokenCount', 'count', 'tokens']) {
      const nested = record[key];
      if (typeof nested === 'number' && Number.isFinite(nested)) return Math.max(0, Math.ceil(nested));
    }
  }
  return 0;
}

function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3));
}

function formatTokenCount(value: number): string {
  return Math.max(0, Math.ceil(value)).toLocaleString('en-US');
}

function setEntryAction(row: PreviewChange, event: Event): void {
  const decisionKey = row.decisionKey;
  if (!decisionKey) return;
  const target = event.target as HTMLSelectElement | null;
  if (!target) return;
  if (target.value === 'custom_saved') {
    target.value = actionSelectValue(row);
    return;
  }
  if (!isEntryAction(target.value)) return;
  if (target.value === 'custom') {
    openCustomEditor(row);
    target.value = actionSelectValue(row);
    return;
  }
  const scrollSnapshot = captureScrollSnapshot(decisionKey);
  const nextCustomOverrides = { ...customEntryOverrides.value };
  delete nextCustomOverrides[decisionKey];
  customEntryOverrides.value = nextCustomOverrides;
  entryActionOverrides.value = { ...entryActionOverrides.value, [decisionKey]: target.value };
  target.blur();
  void generatePreview({ preserveScroll: true, keepRowsUntilReady: true, anchorKey: decisionKey, scrollSnapshot });
}

function actionSelectValue(row: PreviewChange): ActionSelectValue {
  return row.entryAction === 'custom' ? 'custom_saved' : (row.entryAction ?? 'skip');
}

function openCustomEditor(row: PreviewChange): void {
  if (!row.decisionKey) return;
  closeTransientModals();
  const override = customEntryOverrides.value[row.decisionKey];
  customEditorState.open = true;
  customEditorState.decisionKey = row.decisionKey;
  customEditorState.worldbook = row.worldbook;
  customEditorState.uidText = row.uidText;
  customEditorState.entryName = row.entryName;
  customEditorState.fromText = row.fromStateText;
  customEditorState.fromTone = row.fromTone;
  customEditorState.draft = override ? customOverrideToDraft(override) : customRowToDraft(row);
  scheduleModalViewportSync();
}

function cancelCustomEditor(): void {
  closeCustomEditor();
}

function closeCustomEditor(): void {
  customEditorState.open = false;
  customEditorState.decisionKey = null;
  customEditorState.worldbook = '';
  customEditorState.uidText = '';
  customEditorState.entryName = '';
  customEditorState.fromText = '';
  customEditorState.fromTone = 'neutral';
  customEditorState.draft = createEmptyCustomDraft();
}

function saveCustomEditor(): void {
  const decisionKey = customEditorState.decisionKey;
  if (!decisionKey) return;
  const scrollSnapshot = captureScrollSnapshot(decisionKey);
  customEntryOverrides.value = {
    ...customEntryOverrides.value,
    [decisionKey]: customDraftToOverride(customEditorState.draft),
  };
  entryActionOverrides.value = { ...entryActionOverrides.value, [decisionKey]: 'custom' };
  closeCustomEditor();
  void generatePreview({ preserveScroll: true, keepRowsUntilReady: true, anchorKey: decisionKey, scrollSnapshot });
}

function clearCustomEditorOverride(): void {
  const decisionKey = customEditorState.decisionKey;
  if (!decisionKey) return;
  const scrollSnapshot = captureScrollSnapshot(decisionKey);
  const nextCustomOverrides = { ...customEntryOverrides.value };
  delete nextCustomOverrides[decisionKey];
  customEntryOverrides.value = nextCustomOverrides;
  const nextActionOverrides = { ...entryActionOverrides.value };
  delete nextActionOverrides[decisionKey];
  entryActionOverrides.value = nextActionOverrides;
  closeCustomEditor();
  void generatePreview({ preserveScroll: true, keepRowsUntilReady: true, anchorKey: decisionKey, scrollSnapshot });
}

function setCustomEnabled(enabled: boolean): void {
  customEditorState.draft.enabled = enabled;
}

function setCustomStrategy(strategyType: CustomStrategyType): void {
  customEditorState.draft.strategyType = strategyType;
}

function setCustomPositionType(event: Event): void {
  const target = event.target as HTMLSelectElement | null;
  if (!target || !isCustomPositionType(target.value)) return;
  customEditorState.draft.positionType = target.value;
}

function setCustomRole(role: WorldbookEntry['position']['role']): void {
  customEditorState.draft.role = role;
}

function setCustomNumber(field: 'depth' | 'order' | 'probability', event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;
  const value = Number(target.value);
  if (field === 'depth') customEditorState.draft.depth = clampInteger(value, 0, 9999, customEditorState.draft.depth);
  if (field === 'order')
    customEditorState.draft.order = clampInteger(
      value,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      customEditorState.draft.order,
    );
  if (field === 'probability')
    customEditorState.draft.probability = clampInteger(value, 0, 100, customEditorState.draft.probability);
}

function startContentEditing(row: PreviewChange): void {
  if (row.status === 'failed') return;
  const next = new Set(editingContentIds.value);
  next.add(row.contentEditKey);
  editingContentIds.value = next;

  const nextDrafts = { ...contentEditDrafts.value };
  nextDrafts[row.contentEditKey] = contentEditOverrides.value[row.contentEditKey] ?? row.content;
  contentEditDrafts.value = nextDrafts;

  const expanded = new Set(expandedPreviewIds.value);
  expanded.add(row.id);
  expandedPreviewIds.value = expanded;
}

function isContentEditing(contentEditKey: string): boolean {
  return editingContentIds.value.has(contentEditKey);
}

function contentEditValue(row: PreviewChange): string {
  return contentEditDrafts.value[row.contentEditKey] ?? contentEditOverrides.value[row.contentEditKey] ?? row.content;
}

function setContentEditDraft(row: PreviewChange, event: Event): void {
  const target = event.target as HTMLTextAreaElement | null;
  if (!target) return;
  contentEditDrafts.value = { ...contentEditDrafts.value, [row.contentEditKey]: target.value };
}

function saveContentEdit(row: PreviewChange): void {
  const value = contentEditValue(row);
  const anchorKey = row.decisionKey ?? row.contentEditKey;
  const scrollSnapshot = captureScrollSnapshot(anchorKey);
  const nextOverrides = { ...contentEditOverrides.value };
  if (value === row.originalContent) {
    delete nextOverrides[row.contentEditKey];
  } else {
    nextOverrides[row.contentEditKey] = value;
  }
  contentEditOverrides.value = nextOverrides;
  finishContentEditing(row.contentEditKey);
  void generatePreview({ preserveScroll: true, keepRowsUntilReady: true, anchorKey, scrollSnapshot });
}

function cancelContentEdit(row: PreviewChange): void {
  finishContentEditing(row.contentEditKey);
}

function finishContentEditing(contentEditKey: string): void {
  const nextEditing = new Set(editingContentIds.value);
  nextEditing.delete(contentEditKey);
  editingContentIds.value = nextEditing;

  const nextDrafts = { ...contentEditDrafts.value };
  delete nextDrafts[contentEditKey];
  contentEditDrafts.value = nextDrafts;
}

function togglePreviewExpanded(id: string): void {
  const next = new Set(expandedPreviewIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedPreviewIds.value = next;
}

function isPreviewExpanded(id: string): boolean {
  return expandedPreviewIds.value.has(id);
}

function actionTone(row: PreviewChange): ActionTone {
  if (row.status === 'failed') return 'disabled';
  if (row.entryAction === 'promote_to_blue_d0') return 'blue';
  if (row.entryAction === 'promote_to_blue_keep_position') return 'blue';
  if (row.entryAction === 'promote_to_blue_d9999') return 'blue';
  if (row.entryAction === 'keep_green_d0') return 'green';
  if (row.entryAction === 'move_to_d0') return lampToneToActionTone(row.toTone);
  if (row.entryAction === 'clear_cooldown') return 'orange';
  if (row.entryAction === 'custom') return row.nextEnabled ? lampToneToActionTone(row.toTone) : 'disabled';
  if (row.entryAction === 'disable') return 'disabled';
  if (row.entryAction === 'skip') return 'neutral';
  if (row.contentEdited) return 'edit';
  if (row.changed) return 'orange';
  return 'neutral';
}

function actionLabel(row: PreviewChange): string {
  if (row.status === 'failed') return '读取失败';
  if (row.entryAction === 'promote_to_blue_d0') return '改为';
  if (row.entryAction === 'promote_to_blue_keep_position') return '改为';
  if (row.entryAction === 'promote_to_blue_d9999') return '改为';
  if (row.entryAction === 'keep_green_d0') return '保留';
  if (row.entryAction === 'move_to_d0') return '改为';
  if (row.entryAction === 'clear_cooldown') return '清除冷却';
  if (row.entryAction === 'custom') return '自定义';
  if (row.entryAction === 'disable') return '禁用';
  if (row.entryAction === 'skip') return '不处理';
  if (row.contentEdited) return '正文已编辑';
  if (row.changed) return '建议修改';
  return '不变';
}

function actionDetail(row: PreviewChange): string {
  if (row.status === 'failed') return row.entryName;
  if (row.entryAction === 'promote_to_blue_d0') return roleDepthLabel('user', 0);
  if (row.entryAction === 'promote_to_blue_keep_position')
    return row.toText === FILTERED_TEXT ? row.fromText : row.toText;
  if (row.entryAction === 'promote_to_blue_d9999') return roleDepthLabel('user', 9999);
  if (row.entryAction === 'keep_green_d0') return roleDepthLabel('user', 0);
  if (row.entryAction === 'move_to_d0') return roleDepthLabel('user', 0);
  if (row.entryAction === 'clear_cooldown') return '每次满足触发条件都可触发';
  if (row.entryAction === 'custom') return row.nextEnabled ? row.toText : '不会触发';
  if (row.entryAction === 'disable') return '不会触发';
  if (row.entryAction === 'skip') return '保持原样';
  if (row.contentEdited && row.toText !== FILTERED_TEXT) return row.toText;
  if (row.changed && row.toText !== FILTERED_TEXT) return row.toText;
  if (row.ruleLabel === '蓝灯静态不变') return '保持原位置';
  return '保持原位置';
}

function actionTitle(row: PreviewChange): string {
  const detail = actionDetail(row);
  const rule = row.ruleLabel === FILTERED_TEXT ? '' : ` · ${row.ruleLabel}`;
  return `${actionLabel(row)} · ${detail}${rule}`;
}

function lampToneToActionTone(tone: LampTone): ActionTone {
  if (tone === 'blue') return 'blue';
  if (tone === 'green') return 'green';
  if (tone === 'gray') return 'disabled';
  return 'neutral';
}

function contentSegments(row: PreviewChange): ContentSegment[] {
  const text = row.content || '';
  if (!text) return [{ key: `${row.id}:empty`, text: '(空内容)', level: null }];
  const ranges = collectHighlightRanges(row)
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce<Array<{ start: number; end: number; level: RiskLevel }>>((merged, range) => {
      if (range.end <= range.start) return merged;
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end && last.level === range.level) {
        last.end = Math.max(last.end, range.end);
      } else if (!last || range.start >= last.end) {
        merged.push({ ...range });
      }
      return merged;
    }, []);

  const segments: ContentSegment[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      segments.push({ key: `${row.id}:plain:${index}:${cursor}`, text: text.slice(cursor, range.start), level: null });
    }
    segments.push({
      key: `${row.id}:risk:${index}:${range.start}`,
      text: text.slice(range.start, range.end),
      level: range.level,
    });
    cursor = range.end;
  });
  if (cursor < text.length) {
    segments.push({ key: `${row.id}:plain:end:${cursor}`, text: text.slice(cursor), level: null });
  }
  return segments.length > 0 ? segments : [{ key: `${row.id}:plain:all`, text, level: null }];
}

function collectHighlightRanges(row: PreviewChange): Array<{ start: number; end: number; level: RiskLevel }> {
  const text = row.content;
  const ranges: Array<{ start: number; end: number; level: RiskLevel }> = [];
  const seen = new Set<string>();
  row.riskHits.forEach(risk => {
    const excerpts = risk.excerpts?.length ? risk.excerpts : [risk.excerpt];
    excerpts.forEach(excerpt => {
      if (!excerpt || excerpt.length < 2) return;
      let matchedText = excerpt;
      let start = text.indexOf(excerpt);
      if (start === -1) {
        const compactExcerpt = excerpt.replace(/\s+/g, ' ').trim();
        start = text.indexOf(compactExcerpt);
        matchedText = compactExcerpt;
      }
      while (start !== -1) {
        const key = `${start}:${matchedText.length}:${risk.level}`;
        if (!seen.has(key)) {
          seen.add(key);
          ranges.push({ start, end: start + matchedText.length, level: risk.level });
        }
        start = text.indexOf(matchedText, start + matchedText.length);
      }
    });
  });
  return ranges;
}

function buildBookPlan(
  bookName: string,
  entries: WorldbookEntry[],
  includeFiltered: boolean,
  options: BuildBookPlanOptions = {},
): BookPlan {
  const originalRanks = new Map(entries.map((entry, index) => [entry.uid, getPromptOrderRank(entry, index)]));
  const plans = entries.map((entry, index) =>
    applyContentEditOverride(
      applyCustomEntryOverride(
        buildCacheOptimizationEntryPlan(
          bookName,
          entry,
          index,
          originalRanks.get(entry.uid) ?? index,
          options.includeDisabledEntries === true,
        ),
      ),
    ),
  );
  applyD0DynamicBoundary(plans, originalRanks);
  rebalanceTargetOrders(plans, originalRanks);
  assertTargetBucketOrderStable(bookName, plans, originalRanks);
  const finalPlans = options.includeDisabledEntries === true ? plans.map(restoreOriginalDisabledState) : plans;

  const rows = finalPlans.flatMap(plan => {
    const changed = !sameManagedEntry(plan.original, plan.next);
    if (!includeFiltered && !changed) return [];
    return [createPreviewRow(bookName, plan, changed ? 'changed' : 'unchanged', changed)];
  });

  return {
    rows,
    entries: finalPlans.map(plan => plan.next),
    changedCount: finalPlans.filter(plan => !sameManagedEntry(plan.original, plan.next)).length,
  };
}

function buildCacheOptimizationEntryPlan(
  bookName: string,
  entry: WorldbookEntry,
  originalIndex: number,
  promptRank: number,
  includeDisabledEntries: boolean,
): EntryPlan {
  if (!includeDisabledEntries || entry.enabled) return buildEntryPlan(bookName, entry, originalIndex, promptRank);
  const simulatedEntry = { ...entry, enabled: true };
  return {
    ...buildEntryPlan(bookName, simulatedEntry, originalIndex, promptRank),
    original: entry,
  };
}

function restoreOriginalDisabledState(plan: EntryPlan): EntryPlan {
  if (plan.original.enabled) return plan;
  const next = { ...plan.next, enabled: false };
  return {
    ...plan,
    next,
    cacheZoneText: '禁用',
    strategyText: formatStrategyChange(plan.original, next),
  };
}

function buildPromptBuildSpeedBookPlan(bookName: string, entries: WorldbookEntry[]): BookPlan {
  const [bookPlan] = createBlueEntryMergePlan<WorldbookEntryWithImplicit>(
    [{ name: bookName, entries: entries as WorldbookEntryWithImplicit[] }],
    {
      detectRisks: detectEntryRisks,
      estimateTokens: estimateTokenCount,
    },
  ).books;

  const rows = bookPlan.groups.map(group => createBlueMergePreviewRow(bookName, group));
  return {
    rows,
    entries: bookPlan.entries as WorldbookEntry[],
    changedCount: rows.length,
  };
}

function createBlueMergePreviewRow(
  bookName: string,
  group: MergeGroup<WorldbookEntryWithImplicit>,
): PreviewChange {
  const first = group.sourceEntries[0];
  const merged = group.mergedEntry;
  const sourceCount = group.sourceEntries.length;
  const firstIndex = Math.min(...group.sourceIndices);
  const firstOrder = Number.isFinite(first.position.order) ? first.position.order : 0;
  const mergedOrder = Number.isFinite(merged.position.order) ? merged.position.order : firstOrder;
  return {
    id: `merge:${bookName}:${group.sourceUids.join('+')}:${merged.uid}`,
    contentEditKey: `merge:${bookName}:${merged.uid}`,
    previewIndex: 0,
    originalIndex: firstIndex,
    promptRank: getPromptOrderRank(first, firstIndex),
    nextPromptRank: getPromptOrderRank(merged, firstIndex),
    worldbook: bookName,
    uid: merged.uid,
    uidText: `${group.sourceUids.join(', ')} -> ${merged.uid}`,
    entryName: merged.name || '(合并蓝灯)',
    fromText: formatPosition(first.position),
    toText: formatPosition(merged.position),
    nextEnabled: merged.enabled,
    nextStrategyType: merged.strategy.type,
    nextPosition: { ...merged.position },
    nextProbability: merged.probability,
    fromStateText: `蓝灯 ${sourceCount} 条`,
    toStateText: '蓝灯 1 条',
    fromTone: 'blue',
    toTone: 'blue',
    cacheZoneText: `同位置合并 · 净减少 ${sourceCount - 1} 条`,
    strategyText: '删除源条目并新增合并蓝灯',
    orderText: sourceCount > 1 ? `${firstOrder} 起 · 源顺序保留` : String(firstOrder),
    riskText: '已通过安全筛选',
    ruleLabel: '合并蓝灯',
    status: 'changed',
    changed: true,
    reviewNeeded: false,
    decisionKey: null,
    entryAction: null,
    actionChoices: [],
    originalContent: group.content,
    content: merged.content,
    contentLength: merged.content.length,
    contentEdited: false,
    tokenCount: group.tokenEstimate,
    tokenIsEstimated: true,
    mergeSourceCount: sourceCount,
    depthValue: getDepthSortValue(first.position),
    orderValue: firstOrder,
    nextOrderValue: mergedOrder,
    probability: merged.probability,
    priorityValue: extractPriorityValue(first),
    riskHits: [],
  };
}

function entryContentKey(bookName: string, uid: number): string {
  return `${bookName}:${uid}`;
}

function createEmptyCustomDraft(): CustomEditorDraft {
  return {
    enabled: true,
    strategyType: 'constant',
    positionType: 'at_depth',
    role: 'user',
    depth: 0,
    order: 100,
    probability: 100,
  };
}

function createEmptyCustomDraftPosition(): WorldbookEntry['position'] {
  return draftToPosition(createEmptyCustomDraft());
}

function customRowToDraft(row: PreviewChange): CustomEditorDraft {
  return positionToCustomDraft(
    row.nextPosition,
    row.nextEnabled,
    normalizeCustomStrategy(row.nextStrategyType),
    row.nextProbability,
  );
}

function customOverrideToDraft(override: CustomEntryOverride): CustomEditorDraft {
  return positionToCustomDraft(override.position, override.enabled, override.strategyType, override.probability);
}

function positionToCustomDraft(
  position: WorldbookEntry['position'],
  enabled: boolean,
  strategyType: CustomStrategyType,
  probability: number,
): CustomEditorDraft {
  return {
    enabled,
    strategyType,
    positionType: position.type,
    role: position.role ?? 'user',
    depth: clampInteger(position.depth, 0, 9999, 0),
    order: clampInteger(position.order, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100),
    probability: clampInteger(probability, 0, 100, 100),
  };
}

function customDraftToOverride(draft: CustomEditorDraft): CustomEntryOverride {
  return {
    enabled: draft.enabled,
    strategyType: draft.strategyType,
    position: draftToPosition(draft),
    probability: clampInteger(draft.probability, 0, 100, 100),
  };
}

function draftToPosition(draft: CustomEditorDraft): WorldbookEntry['position'] {
  return {
    type: draft.positionType,
    role: draft.role,
    depth: clampInteger(draft.depth, 0, 9999, 0),
    order: clampInteger(draft.order, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100),
  };
}

function normalizeCustomStrategy(strategyType: WorldbookEntry['strategy']['type']): CustomStrategyType {
  return strategyType === 'selective' ? 'selective' : 'constant';
}

function applyCustomEntryOverride(plan: EntryPlan): EntryPlan {
  const decisionKey = plan.decisionKey ?? plan.contentEditKey;
  const override = customEntryOverrides.value[decisionKey];
  if (!override) return plan;

  const next = applyCustomOverride(plan.original, override);
  const riskHits = detectEntryRisks(next);
  return {
    ...plan,
    next,
    matched: true,
    ruleLabel: '自定义',
    cacheZoneText: next.enabled ? cacheZoneLabelForEntry(next) : '禁用',
    strategyText: formatStrategyChange(plan.original, next),
    riskHits,
    riskText: formatRisks(riskHits),
    decisionKey,
    entryAction: 'custom',
    actionChoices: ensureCustomActionChoices(
      plan.actionChoices.length > 0 ? plan.actionChoices : passiveActionChoices(),
      '⚙ 编辑自定义...',
    ),
    shouldRebalanceOrder: false,
  };
}

function applyCustomOverride(entry: WorldbookEntry, override: CustomEntryOverride): WorldbookEntry {
  return {
    ...entry,
    enabled: override.enabled,
    strategy: {
      ...entry.strategy,
      type: override.strategyType,
    },
    position: { ...override.position },
    probability: override.probability,
  };
}

function applyContentEditOverride(plan: EntryPlan): EntryPlan {
  const override = contentEditOverrides.value[plan.contentEditKey];
  if (override === undefined) return plan;

  const next = { ...plan.next, content: override };
  const riskHits = detectEntryRisks(next);
  const contentEdited = override !== plan.original.content;
  return {
    ...plan,
    next,
    matched: plan.matched || contentEdited,
    ruleLabel: plan.ruleLabel === FILTERED_TEXT && contentEdited ? '正文编辑' : plan.ruleLabel,
    cacheZoneText:
      plan.cacheZoneText === FILTERED_TEXT && contentEdited ? cacheZoneLabelForEntry(next) : plan.cacheZoneText,
    strategyText:
      plan.strategyText === FILTERED_TEXT && contentEdited
        ? formatStrategyChange(plan.original, next)
        : plan.strategyText,
    riskHits,
    riskText: formatRisks(riskHits),
    contentEdited,
  };
}

function buildEntryPlan(bookName: string, entry: WorldbookEntry, originalIndex: number, promptRank: number): EntryPlan {
  if (isDatabasePluginEntry(entry)) {
    return buildDatabasePluginEntryPlan(bookName, entry, originalIndex, promptRank);
  }

  const riskHits = detectEntryRisks(entry);
  const presetPlan = buildDsV4PresetPlan(bookName, entry, riskHits, originalIndex, promptRank);
  if (presetPlan) return presetPlan;

  return {
    original: entry,
    next: entry,
    originalIndex,
    promptRank,
    contentEditKey: entryContentKey(bookName, entry.uid),
    contentEdited: false,
    matched: false,
    ruleLabel: FILTERED_TEXT,
    cacheZoneText: FILTERED_TEXT,
    strategyText: FILTERED_TEXT,
    riskHits,
    riskText: formatRisks(riskHits),
    decisionKey: null,
    entryAction: null,
    actionChoices: [],
    shouldRebalanceOrder: false,
  };
}

function isDatabasePluginEntry(entry: WorldbookEntry): boolean {
  return entry.name.trim().startsWith(DATABASE_PLUGIN_ENTRY_PREFIX);
}

function buildDatabasePluginEntryPlan(
  bookName: string,
  entry: WorldbookEntry,
  originalIndex: number,
  promptRank: number,
): EntryPlan {
  return {
    original: entry,
    next: entry,
    originalIndex,
    promptRank,
    contentEditKey: entryContentKey(bookName, entry.uid),
    contentEdited: false,
    matched: true,
    ruleLabel: DATABASE_PLUGIN_RULE_LABEL,
    cacheZoneText: cacheZoneLabelForEntry(entry),
    strategyText: '不变',
    riskHits: [],
    riskText: FILTERED_TEXT,
    decisionKey: null,
    entryAction: null,
    actionChoices: [],
    shouldRebalanceOrder: false,
  };
}

function buildDsV4PresetPlan(
  bookName: string,
  entry: WorldbookEntry,
  riskHits: RiskHit[],
  originalIndex: number,
  promptRank: number,
): EntryPlan | null {
  if (!entry.enabled || !isManagedLampEntry(entry)) return null;
  const decisionKey = `${bookName}:${entry.uid}`;

  if (hasBlockingRisks(risksAffectingPosition(riskHits))) {
    const choices = dynamicActionChoices(entry);
    const action = resolveEntryAction(decisionKey, choices, 'move_to_d0');
    return buildActionPlan(
      bookName,
      entry,
      riskHits,
      decisionKey,
      action,
      choices,
      '动态 → 用户 D0',
      originalIndex,
      promptRank,
    );
  }

  const depthBand = staticDepthBand(entry.position);
  if (depthBand === 'tail') {
    const choices = tailDepthActionChoices(entry);
    const defaultAction = entry.strategy.type === 'selective' ? 'keep_green_d0' : 'move_to_d0';
    const action = resolveEntryAction(decisionKey, choices, defaultAction);
    return buildActionPlan(
      bookName,
      entry,
      riskHits,
      decisionKey,
      action,
      choices,
      'D0-D9 → 用户 D0',
      originalIndex,
      promptRank,
    );
  }

  if (depthBand === 'fixed') {
    const choices = fixedDepthActionChoices(entry);
    const action = resolveEntryAction(decisionKey, choices, 'promote_to_blue_d9999');
    return buildActionPlan(
      bookName,
      entry,
      riskHits,
      decisionKey,
      action,
      choices,
      'D10+ → 蓝灯用户 D9999',
      originalIndex,
      promptRank,
    );
  }

  if (entry.strategy.type === 'selective') {
    const choices = greenActionChoices(entry);
    const action = resolveEntryAction(decisionKey, choices, 'promote_to_blue_keep_position');
    return buildActionPlan(
      bookName,
      entry,
      riskHits,
      decisionKey,
      action,
      choices,
      '绿灯静态 → 蓝灯原位',
      originalIndex,
      promptRank,
    );
  }

  if (entry.strategy.type === 'constant') {
    if (hasCooldownRisk(riskHits)) {
      const choices = cooldownActionChoices();
      const action = resolveEntryAction(decisionKey, choices, 'clear_cooldown');
      return buildActionPlan(
        bookName,
        entry,
        riskHits,
        decisionKey,
        action,
        choices,
        '清除条目冷却',
        originalIndex,
        promptRank,
      );
    }

    return {
      original: entry,
      next: entry,
      originalIndex,
      promptRank,
      contentEditKey: entryContentKey(bookName, entry.uid),
      contentEdited: false,
      matched: true,
      ruleLabel: '蓝灯静态不变',
      cacheZoneText: cacheZoneLabelForEntry(entry),
      strategyText: '不变',
      riskHits,
      riskText: formatRisks(riskHits),
      decisionKey,
      entryAction: 'skip',
      actionChoices: passiveActionChoices(),
      shouldRebalanceOrder: false,
    };
  }

  return null;
}

function buildActionPlan(
  bookName: string,
  entry: WorldbookEntry,
  riskHits: RiskHit[],
  decisionKey: string,
  action: EntryAction,
  actionChoices: ActionChoice[],
  ruleLabel: string,
  originalIndex: number,
  promptRank: number,
): EntryPlan {
  const next = applyEntryAction(entry, action);
  return {
    original: entry,
    next,
    originalIndex,
    promptRank,
    contentEditKey: entryContentKey(bookName, entry.uid),
    contentEdited: false,
    matched: true,
    ruleLabel,
    cacheZoneText: actionCacheZoneLabel(action, next),
    strategyText: formatStrategyChange(entry, next),
    riskHits,
    riskText: formatRisks(riskHits),
    decisionKey,
    entryAction: action,
    actionChoices,
    shouldRebalanceOrder: shouldRebalanceEntryAction(action, entry, next),
  };
}

function applyEntryAction(entry: WorldbookEntry, action: EntryAction): WorldbookEntry {
  if (action === 'skip') return entry;
  if (action === 'custom') return entry;
  if (action === 'disable') return { ...entry, enabled: false };
  const entryWithoutCooldown = clearEntryCooldown(entry);
  if (action === 'clear_cooldown') return entryWithoutCooldown;
  if (action === 'promote_to_blue_d0') {
    return applyTarget(
      {
        ...entryWithoutCooldown,
        enabled: true,
        strategy: { ...entryWithoutCooldown.strategy, type: 'constant' },
      },
      TAIL_ATTENTION_TARGET,
    );
  }
  if (action === 'promote_to_blue_keep_position') {
    return {
      ...entryWithoutCooldown,
      enabled: true,
      strategy: { ...entryWithoutCooldown.strategy, type: 'constant' },
    };
  }
  if (action === 'promote_to_blue_d9999') {
    return applyTarget(
      {
        ...entryWithoutCooldown,
        enabled: true,
        strategy: { ...entryWithoutCooldown.strategy, type: 'constant' },
      },
      FIXED_CACHE_TARGET,
    );
  }
  if (action === 'keep_green_d0') {
    return applyTarget({ ...entryWithoutCooldown, enabled: true }, TAIL_ATTENTION_TARGET);
  }
  if (action === 'move_to_d0') {
    return applyTarget({ ...entryWithoutCooldown, enabled: true }, TAIL_ATTENTION_TARGET);
  }
  return entry;
}

function clearEntryCooldown(entry: WorldbookEntry): WorldbookEntry {
  if (entry.effect.cooldown === null) return entry;
  return {
    ...entry,
    effect: {
      ...entry.effect,
      cooldown: null,
    },
  };
}

function shouldRebalanceEntryAction(action: EntryAction, original: WorldbookEntry, next: WorldbookEntry): boolean {
  return (
    action !== 'skip' &&
    action !== 'disable' &&
    action !== 'custom' &&
    next.enabled &&
    atDepthBucketKey(next.position) !== null &&
    !samePosition(original.position, next.position)
  );
}

function applyD0DynamicBoundary(plans: EntryPlan[], originalRanks: Map<number, number>): void {
  const d0Plans = plans
    .filter(plan => plan.next.enabled && atDepthBucketKey(plan.next.position) === 'user:0')
    .sort(
      (left, right) =>
        (originalRanks.get(left.original.uid) ?? Number.MAX_SAFE_INTEGER) -
        (originalRanks.get(right.original.uid) ?? Number.MAX_SAFE_INTEGER),
    );

  const dynamicBoundaryIndex = d0Plans.findIndex(plan => planHasRemainingBlockingRisk(plan));
  if (dynamicBoundaryIndex <= 0) return;

  for (let index = 0; index < dynamicBoundaryIndex; index += 1) {
    const plan = d0Plans[index];
    if (plan.entryAction === 'custom') continue;
    if (!plan.decisionKey || entryActionOverrides.value[plan.decisionKey] !== undefined) continue;
    if (planHasRemainingBlockingRisk(plan) || plan.next.strategy.type !== 'selective') continue;

    plan.next = applyEntryAction(plan.next, 'promote_to_blue_d0');
    plan.entryAction = 'promote_to_blue_d0';
    plan.ruleLabel = 'D0-D9 → 蓝灯 D0（动态前）';
    plan.cacheZoneText = actionCacheZoneLabel('promote_to_blue_d0', plan.next);
    plan.strategyText = formatStrategyChange(plan.original, plan.next);
    plan.shouldRebalanceOrder = shouldRebalanceEntryAction('promote_to_blue_d0', plan.original, plan.next);
  }
}

function rebalanceTargetOrders(plans: EntryPlan[], originalRanks: Map<number, number>): void {
  const touchedBuckets = new Set(
    plans
      .filter(plan => plan.shouldRebalanceOrder && plan.next.enabled)
      .map(plan => atDepthBucketKey(plan.next.position))
      .filter((key): key is string => key !== null),
  );

  for (const bucket of touchedBuckets) {
    const lockedOrders = new Set(
      plans
        .filter(
          plan => plan.entryAction === 'custom' && plan.next.enabled && atDepthBucketKey(plan.next.position) === bucket,
        )
        .map(plan => plan.next.position.order),
    );
    let nextOrder = ORDER_BASE;
    plans
      .filter(
        plan => plan.next.enabled && plan.entryAction !== 'custom' && atDepthBucketKey(plan.next.position) === bucket,
      )
      .sort((left, right) => {
        const leftRank = originalRanks.get(left.original.uid) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = originalRanks.get(right.original.uid) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      })
      .forEach(plan => {
        while (lockedOrders.has(nextOrder)) {
          nextOrder += ORDER_STEP;
        }
        plan.next = {
          ...plan.next,
          position: {
            ...plan.next.position,
            order: nextOrder,
          },
        };
        nextOrder += ORDER_STEP;
        if (!plan.matched) {
          plan.ruleLabel = '同层顺序重排';
          plan.cacheZoneText = cacheZoneLabelForEntry(plan.next);
          plan.strategyText = formatStrategyChange(plan.original, plan.next);
        }
      });
  }
}

function assertTargetBucketOrderStable(bookName: string, plans: EntryPlan[], originalRanks: Map<number, number>): void {
  const buckets = new Map<string, EntryPlan[]>();
  for (const plan of plans) {
    if (!plan.next.enabled) continue;
    if (plan.entryAction === 'custom') continue;
    const bucket = atDepthBucketKey(plan.next.position);
    if (!bucket) continue;
    const existing = buckets.get(bucket) ?? [];
    existing.push(plan);
    buckets.set(bucket, existing);
  }

  for (const [bucket, bucketPlans] of buckets) {
    const originalOrder = [...bucketPlans]
      .sort(
        (left, right) =>
          (originalRanks.get(left.original.uid) ?? Number.MAX_SAFE_INTEGER) -
          (originalRanks.get(right.original.uid) ?? Number.MAX_SAFE_INTEGER),
      )
      .map(plan => plan.original.uid)
      .join(',');
    const nextOrder = [...bucketPlans]
      .sort(
        (left, right) =>
          getPromptOrderRank(left.next, left.originalIndex) - getPromptOrderRank(right.next, right.originalIndex),
      )
      .map(plan => plan.original.uid)
      .join(',');
    if (originalOrder !== nextOrder) {
      throw new Error(
        `顺序校验失败：${bookName} 的目标位置 ${formatAtDepthBucketKey(bucket)} 内，条目前后关系发生反转，已取消本次处理。`,
      );
    }
  }
}

function createPreviewRow(bookName: string, plan: EntryPlan, status: PreviewStatus, changed: boolean): PreviewChange {
  const originalOrder = Number.isFinite(plan.original.position.order) ? plan.original.position.order : 0;
  const nextOrder = Number.isFinite(plan.next.position.order) ? plan.next.position.order : 0;
  return {
    id: `${bookName}:${plan.original.uid}:${plan.ruleLabel}:${status}`,
    contentEditKey: plan.contentEditKey,
    previewIndex: 0,
    originalIndex: plan.originalIndex,
    promptRank: plan.promptRank,
    nextPromptRank: getPromptOrderRank(plan.next, plan.originalIndex),
    worldbook: bookName,
    uid: plan.original.uid,
    uidText: String(plan.original.uid),
    entryName: plan.original.name || '(未命名)',
    fromText: formatPosition(plan.original.position),
    toText: status === 'filtered' ? FILTERED_TEXT : formatPosition(plan.next.position),
    nextEnabled: plan.next.enabled,
    nextStrategyType: plan.next.strategy.type,
    nextPosition: { ...plan.next.position },
    nextProbability: plan.next.probability,
    fromStateText: formatEntryState(plan.original),
    toStateText: status === 'filtered' ? FILTERED_TEXT : formatEntryState(plan.next),
    fromTone: entryTone(plan.original),
    toTone: status === 'filtered' ? 'neutral' : entryTone(plan.next),
    cacheZoneText: status === 'filtered' ? FILTERED_TEXT : plan.cacheZoneText,
    strategyText:
      status === 'filtered' ? FILTERED_TEXT : changed ? formatStrategyChange(plan.original, plan.next) : '不变',
    orderText: status === 'filtered' ? FILTERED_TEXT : formatOrderChange(plan.original, plan.next),
    riskText: plan.riskText,
    ruleLabel: plan.ruleLabel,
    status,
    changed,
    reviewNeeded: planHasRemainingBlockingRisk(plan),
    decisionKey: plan.decisionKey,
    entryAction: plan.entryAction,
    actionChoices: plan.actionChoices,
    originalContent: plan.original.content,
    content: plan.next.content,
    contentLength: plan.next.content.length,
    contentEdited: plan.contentEdited,
    tokenCount: 0,
    tokenIsEstimated: true,
    depthValue: getDepthSortValue(plan.original.position),
    orderValue: originalOrder,
    nextOrderValue: nextOrder,
    probability: plan.original.probability,
    priorityValue: extractPriorityValue(plan.original),
    riskHits: plan.riskHits,
  };
}

function applyTarget(entry: WorldbookEntry, target: PositionTarget): WorldbookEntry {
  if (target.type === 'at_depth') {
    return {
      ...entry,
      position: {
        ...entry.position,
        type: 'at_depth',
        role: target.role,
        depth: target.depth,
      },
    };
  }
  return {
    ...entry,
    position: {
      ...entry.position,
      type: target.type,
    },
  };
}

function samePosition(left: WorldbookEntry['position'], right: WorldbookEntry['position']): boolean {
  return (
    left.type === right.type && left.role === right.role && left.depth === right.depth && left.order === right.order
  );
}

function sameManagedEntry(left: WorldbookEntry, right: WorldbookEntry): boolean {
  return (
    left.enabled === right.enabled &&
    left.strategy.type === right.strategy.type &&
    left.probability === right.probability &&
    left.content === right.content &&
    sameEntryEffect(left, right) &&
    samePosition(left.position, right.position)
  );
}

function sameEntryEffect(left: WorldbookEntry, right: WorldbookEntry): boolean {
  return (
    left.effect.sticky === right.effect.sticky &&
    left.effect.cooldown === right.effect.cooldown &&
    left.effect.delay === right.effect.delay
  );
}

function formatEntryState(entry: WorldbookEntry): string {
  return formatPosition(entry.position);
}

function entryTone(entry: WorldbookEntry): LampTone {
  if (!entry.enabled) return 'gray';
  if (entry.strategy.type === 'constant') return 'blue';
  if (entry.strategy.type === 'selective') return 'green';
  return 'neutral';
}

function formatPosition(position: WorldbookEntry['position']): string {
  const labelMap: Record<WorldbookEntry['position']['type'], string> = {
    before_character_definition: '角色定义前（↑ Char）',
    after_character_definition: '角色定义后（↓ Char）',
    before_example_messages: '示例消息前（↑ EM）',
    after_example_messages: '示例消息后（↓ EM）',
    before_author_note: '作者注释前（↑ AN）',
    after_author_note: '作者注释后（↓ AN）',
    at_depth: '@D',
    outlet: '➡️ 锚点',
  };
  if (position.type === 'at_depth') return roleDepthLabel(position.role, position.depth);
  return labelMap[position.type];
}

function roleDepthLabel(role: WorldbookEntry['position']['role'], depth: number): string {
  return `${roleInsertionLabel(role)} @D${depth}`;
}

function roleInsertionLabel(role: WorldbookEntry['position']['role']): string {
  const labelMap: Record<WorldbookEntry['position']['role'], string> = {
    system: '[系统⚙]',
    user: '[用户👤]',
    assistant: '[AI🤖]',
  };
  return labelMap[role];
}

function getDepthSortValue(position: WorldbookEntry['position']): number {
  return position.type === 'at_depth' ? position.depth : -1;
}

function extractPriorityValue(entry: WorldbookEntry): number | null {
  const record = entry as unknown as Record<string, unknown>;
  const extra = entry.extra ?? {};
  const candidates = [record.priority, record.priorityValue, extra.priority, extra.priorityValue];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatOrderChange(original: WorldbookEntry, next: WorldbookEntry): string {
  const from = Number.isFinite(original.position.order) ? original.position.order : 0;
  const to = Number.isFinite(next.position.order) ? next.position.order : 0;
  return from === to ? String(from) : `${from} -> ${to}`;
}

function formatStrategyChange(original: WorldbookEntry, next: WorldbookEntry): string {
  if (original.enabled && !next.enabled) return '启用 -> 禁用';
  if (!original.enabled && next.enabled) return '禁用 -> 启用';
  const from = strategyLabel(original.strategy.type);
  const to = strategyLabel(next.strategy.type);
  return from === to ? from : `${from} -> ${to}`;
}

function strategyLabel(strategy: WorldbookEntry['strategy']['type']): string {
  const labelMap: Record<WorldbookEntry['strategy']['type'], string> = {
    constant: '蓝灯',
    selective: '绿灯',
    vectorized: '向量化',
  };
  return labelMap[strategy];
}

function cacheZoneLabelForEntry(entry: WorldbookEntry): string {
  return cacheZoneLabelForPosition(entry.position);
}

function cacheZoneLabelForPosition(position: WorldbookEntry['position']): string {
  if (position.type !== 'at_depth') return '固定设定区';
  if (position.depth === 9999 && position.role === 'user') return '固定前缀';
  if (position.depth === 0 && position.role === 'user') return '尾部高注意力';
  return '手动深度';
}

function actionCacheZoneLabel(action: EntryAction, next: WorldbookEntry): string {
  if (action === 'disable') return '禁用';
  if (action === 'skip') return '不处理';
  if (action === 'clear_cooldown') return '清除冷却';
  if (action === 'custom' && !next.enabled) return '禁用';
  return cacheZoneLabelForEntry(next);
}

function formatRisks(risks: RiskHit[]): string {
  if (risks.length === 0) return FILTERED_TEXT;
  return risks.map(riskDisplayLabel).join('、');
}

function riskDisplayLabel(risk: RiskHit): string {
  if (isUnknownMacroRisk(risk)) {
    return `${risk.label}${riskCountLabel(risk)}`;
  }
  return risk.label;
}

function riskTitle(risk: RiskHit): string {
  if (!isUnknownMacroRisk(risk)) return risk.excerpt;
  const countText = (risk.count ?? 1) > 1 ? `检测到 ${risk.count} 个未识别 {{...}} 宏` : '检测到未识别 {{...}} 宏';
  const examples = compactRiskExamples(risk);
  return examples ? `${countText}；示例：${examples}` : countText;
}

function compactRiskExamples(risk: RiskHit): string {
  const excerpts = risk.excerpts?.length ? risk.excerpts : risk.excerpt ? [risk.excerpt] : [];
  if (excerpts.length === 0) return '';
  const examples = excerpts.slice(0, 3).join('、');
  return excerpts.length > 3 ? `${examples} 等` : examples;
}

function isUnknownMacroRisk(risk: RiskHit): boolean {
  return risk.label === '未知宏';
}

function riskCountLabel(risk: RiskHit): string {
  return (risk.count ?? 1) > 1 ? ` ×${risk.count}` : '';
}

function hasBlockingRisks(risks: RiskHit[]): boolean {
  return risks.some(risk => risk.level !== 'warning');
}

function hasCooldownRisk(risks: RiskHit[]): boolean {
  return risks.some(risk => risk.label === ENTRY_COOLDOWN_RISK_LABEL);
}

function risksAffectingPosition(risks: RiskHit[]): RiskHit[] {
  return risks.filter(risk => risk.label !== ENTRY_COOLDOWN_RISK_LABEL);
}

function planHasRemainingBlockingRisk(plan: EntryPlan): boolean {
  return plan.riskHits.some(risk => risk.level !== 'warning' && riskStillAppliesAfterPlan(plan, risk));
}

function riskStillAppliesAfterPlan(plan: EntryPlan, risk: RiskHit): boolean {
  if (risk.label === ENTRY_COOLDOWN_RISK_LABEL && plan.next.effect.cooldown === null) return false;
  return true;
}

function isManagedLampEntry(entry: WorldbookEntry): boolean {
  return entry.strategy.type === 'constant' || entry.strategy.type === 'selective';
}

function staticDepthBand(position: WorldbookEntry['position']): StaticDepthBand {
  if (position.type !== 'at_depth') return null;
  if (position.depth >= 0 && position.depth < TAIL_STATIC_DEPTH_LIMIT) return 'tail';
  if (position.depth >= TAIL_STATIC_DEPTH_LIMIT) return 'fixed';
  return null;
}

function resolveEntryAction(decisionKey: string, choices: ActionChoice[], defaultAction: EntryAction): EntryAction {
  const override = entryActionOverrides.value[decisionKey];
  if (override === 'custom') return defaultAction;
  if (override && choices.some(choice => choice.value === override)) return override;
  return defaultAction;
}

function detectEntryRisks(entry: WorldbookEntry): RiskHit[] {
  const text = entry.content;
  const risks: RiskHit[] = [];
  const riskLevelRank: Record<RiskLevel, number> = {
    warning: 0,
    unknown: 1,
    dynamic: 2,
  };
  const addRisk = (label: string, level: RiskLevel, excerpt = '') => {
    const existing = risks.find(risk => risk.label === label);
    if (!existing) {
      risks.push({ label, level, excerpt, excerpts: excerpt ? [excerpt] : [], count: 1 });
      return;
    }
    existing.count = (existing.count ?? 1) + 1;
    if (riskLevelRank[level] > riskLevelRank[existing.level]) {
      existing.level = level;
    }
    if (!existing.excerpt && excerpt) {
      existing.excerpt = excerpt;
    }
    if (excerpt && !(existing.excerpts ?? []).includes(excerpt)) {
      existing.excerpts = [...(existing.excerpts ?? []), excerpt];
    }
  };

  if (entry.probability !== 100) addRisk('概率非100', 'dynamic', `probability=${entry.probability}`);
  if (entry.effect.sticky !== null) addRisk('黏性', 'dynamic', `sticky=${entry.effect.sticky}`);
  if (entry.effect.cooldown !== null)
    addRisk(ENTRY_COOLDOWN_RISK_LABEL, 'dynamic', `cooldown=${entry.effect.cooldown}`);
  if (entry.effect.delay !== null) addRisk('延迟', 'dynamic', `delay=${entry.effect.delay}`);
  if (/<%|%>/.test(text)) addRisk('EJS模板', 'dynamic', extractPatternExcerpt(text, /<%|%>/));
  if (/\b(?:getvar|setvar|addvar|incvar|decvar|hasvar|deletevar)\s*\(/i.test(text)) {
    addRisk(
      '变量读写函数',
      'dynamic',
      extractPatternExcerpt(text, /\b(?:getvar|setvar|addvar|incvar|decvar|hasvar|deletevar)\s*\(/i),
    );
  }
  if (/stat_data|Mvu|mvu/.test(text)) addRisk('MVU变量', 'dynamic', extractPatternExcerpt(text, /stat_data|Mvu|mvu/));
  if (
    /\{\{(?:(?:get|format)_(?:global|preset|character|chat|message)_variable|format_(?:global|preset|character|chat|message)_message)::/i.test(
      text,
    )
  ) {
    addRisk(
      '酒馆助手变量',
      'dynamic',
      extractPatternExcerpt(
        text,
        /\{\{(?:(?:get|format)_(?:global|preset|character|chat|message)_variable|format_(?:global|preset|character|chat|message)_message)::/i,
      ),
    );
  }

  for (const macro of extractMacros(text)) {
    const risk = classifyMacro(macro);
    if (risk) addRisk(risk.label, risk.level, risk.excerpt);
  }

  return risks;
}

function extractPatternExcerpt(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match) return '';
  const start = Math.max(0, match.index - 24);
  const end = Math.min(text.length, match.index + match[0].length + 24);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function extractMacros(text: string): MacroHit[] {
  const macros: MacroHit[] = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('{{', index);
    if (start === -1) break;
    let depth = 1;
    let cursor = start + 2;
    while (cursor < text.length && depth > 0) {
      if (text.startsWith('{{', cursor)) {
        depth += 1;
        cursor += 2;
        continue;
      }
      if (text.startsWith('}}', cursor)) {
        depth -= 1;
        cursor += 2;
        continue;
      }
      cursor += 1;
    }
    if (depth !== 0) break;
    const raw = text.slice(start, cursor);
    const body = raw.slice(2, -2).trim();
    const parts = body
      .split('::')
      .map(part => part.trim())
      .filter(Boolean);
    const name = normalizeMacroName(parts[0] ?? body);
    macros.push({ raw, name, args: parts.slice(1) });
    if (body.includes('{{')) {
      macros.push(...extractMacros(body));
    }
    index = cursor;
  }

  for (const match of text.matchAll(/<(USER|BOT|CHAR|GROUP)>/gi)) {
    const raw = match[0];
    macros.push({ raw, name: normalizeMacroName(match[1]), args: [] });
  }

  return macros;
}

function classifyMacro(macro: MacroHit): RiskHit | null {
  if (!macro.name) return { label: '未知宏', level: 'unknown', excerpt: macro.raw };
  if (macro.name.startsWith('$') || macro.name.startsWith('.')) {
    return { label: '变量宏', level: 'dynamic', excerpt: macro.raw };
  }
  if (DYNAMIC_MACROS.has(macro.name)) {
    return { label: dynamicMacroLabel(macro.name), level: 'dynamic', excerpt: macro.raw };
  }
  if (WARNING_MACROS.has(macro.name)) {
    return { label: settingMacroLabel(macro.name), level: 'warning', excerpt: macro.raw };
  }
  if (STABLE_MACROS.has(macro.name) || LEGACY_STABLE_MACROS.has(macro.name)) return null;
  if (LEGACY_WARNING_MACROS.has(macro.name)) {
    return { label: '场景相关宏', level: 'warning', excerpt: macro.raw };
  }
  return { label: '未知宏', level: 'unknown', excerpt: macro.raw };
}

function normalizeMacroName(raw: string): string {
  return (
    raw
      .trim()
      .split(/\s|:/)[0]
      ?.replace(/[{}<>]/g, '')
      .toLowerCase() ?? ''
  );
}

function dynamicMacroLabel(name: string): string {
  if (['random', 'pick'].includes(name)) return '随机宏';
  if (name === 'roll') return '骰子宏';
  if (
    [
      'time',
      'date',
      'weekday',
      'isotime',
      'isodate',
      'datetimeformat',
      'idleduration',
      'idle_duration',
      'timediff',
    ].includes(name)
  ) {
    return '时间宏';
  }
  if (
    [
      'lastmessage',
      'lastmessageid',
      'lastusermessage',
      'lastcharmessage',
      'firstincludedmessageid',
      'firstdisplayedmessageid',
      'lastswipeid',
      'currentswipeid',
      'allchatrange',
      'summary',
      'input',
    ].includes(name)
  ) {
    return '聊天内容宏';
  }
  if (
    name.endsWith('_variable') ||
    name.endsWith('_message') ||
    ['get_message_variable', 'format_message_variable'].includes(name)
  )
    return '酒馆助手变量';
  return '变量宏';
}

function settingMacroLabel(name: string): string {
  if (['group', 'groupnotmuted', 'notchar'].includes(name)) return '场景相关宏';
  if (['model', 'maxprompt', 'maxcontexttokens', 'maxresponsetokens'].includes(name)) return '模型/上下文设置宏';
  return '环境设置宏';
}

function getPromptOrderRank(entry: WorldbookEntry, index: number): number {
  // Smaller rank means earlier in the prompt; same-depth order stays part of the ranking.
  const order = Number.isFinite(entry.position.order) ? entry.position.order : 0;
  if (entry.position.type === 'at_depth') {
    return 1_000_000 - entry.position.depth * 100_000 + order + index / 100_000;
  }
  const baseMap: Record<Exclude<WorldbookEntry['position']['type'], 'at_depth'>, number> = {
    before_character_definition: 100_000,
    after_character_definition: 200_000,
    before_example_messages: 300_000,
    after_example_messages: 400_000,
    before_author_note: 500_000,
    after_author_note: 600_000,
    outlet: 700_000,
  };
  return baseMap[entry.position.type] + order + index / 100_000;
}

function atDepthBucketKey(position: WorldbookEntry['position']): string | null {
  if (position.type !== 'at_depth') return null;
  return `${position.role}:${position.depth}`;
}

function formatAtDepthBucketKey(bucket: string): string {
  const [role, depthText] = bucket.split(':');
  const depth = Number(depthText);
  if ((role === 'system' || role === 'user' || role === 'assistant') && Number.isFinite(depth)) {
    return roleDepthLabel(role, depth);
  }
  return bucket;
}

function ensureCustomActionChoices(choices: ActionChoice[], customLabel = '⚙ 自定义...'): ActionChoice[] {
  if (choices.some(choice => choice.value === 'custom')) {
    return choices.map(choice => (choice.value === 'custom' ? { ...choice, label: customLabel } : choice));
  }
  return [...choices, { value: 'custom', label: customLabel }];
}

function passiveActionChoices(): ActionChoice[] {
  return ensureCustomActionChoices([{ value: 'skip', label: '↩ 保持原样' }]);
}

function greenActionChoices(entry: WorldbookEntry): ActionChoice[] {
  return ensureCustomActionChoices([
    { value: 'promote_to_blue_keep_position', label: `🔵 ${formatPosition(entry.position)}` },
    { value: 'promote_to_blue_d9999', label: `🔵 ${roleDepthLabel('user', 9999)}` },
    { value: 'keep_green_d0', label: `🟢 ${roleDepthLabel('user', 0)}` },
    { value: 'disable', label: `⚫ 禁用` },
    { value: 'skip', label: '↩ 不处理 · 保持原样' },
  ]);
}

function tailDepthActionChoices(entry: WorldbookEntry): ActionChoice[] {
  const base: ActionChoice[] =
    entry.strategy.type === 'selective'
      ? [
          { value: 'keep_green_d0', label: `🟢 ${roleDepthLabel('user', 0)}` },
          { value: 'promote_to_blue_d0', label: `🔵 ${roleDepthLabel('user', 0)}` },
        ]
      : [{ value: 'move_to_d0', label: `${entryLampIcon(entry)} ${roleDepthLabel('user', 0)}` }];
  return ensureCustomActionChoices([
    ...base,
    { value: 'disable', label: `⚫ 禁用` },
    { value: 'skip', label: '↩ 不处理 · 保持原样' },
  ]);
}

function fixedDepthActionChoices(_entry: WorldbookEntry): ActionChoice[] {
  return ensureCustomActionChoices([
    { value: 'promote_to_blue_d9999', label: `🔵 ${roleDepthLabel('user', 9999)}` },
    { value: 'disable', label: `⚫ 禁用` },
    { value: 'skip', label: '↩ 不处理 · 保持原样' },
  ]);
}

function dynamicActionChoices(entry: WorldbookEntry): ActionChoice[] {
  return ensureCustomActionChoices([
    { value: 'move_to_d0', label: `${entryLampIcon(entry)} ${roleDepthLabel('user', 0)}` },
    { value: 'disable', label: `⚫ 禁用` },
    { value: 'skip', label: '↩ 不处理 · 保持原样' },
  ]);
}

function cooldownActionChoices(): ActionChoice[] {
  return ensureCustomActionChoices([
    { value: 'clear_cooldown', label: '清除冷却' },
    { value: 'disable', label: `⚫ 禁用` },
    { value: 'skip', label: '↩ 不处理 · 保持原样' },
  ]);
}

function isEntryAction(value: string): value is EntryAction {
  return [
    'promote_to_blue_d0',
    'promote_to_blue_keep_position',
    'promote_to_blue_d9999',
    'keep_green_d0',
    'move_to_d0',
    'clear_cooldown',
    'custom',
    'disable',
    'skip',
  ].includes(value);
}

function isCustomPositionType(value: string): value is CustomPositionType {
  return customPositionOptions.some(option => option.value === value);
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function entryLampIcon(entry: WorldbookEntry): string {
  if (!entry.enabled) return '⚫';
  if (entry.strategy.type === 'selective') return '🟢';
  if (entry.strategy.type === 'constant') return '🔵';
  return '●';
}

function statusLabel(status: PreviewStatus): string {
  const labelMap: Record<PreviewStatus, string> = {
    changed: '建议修改',
    unchanged: '不变',
    filtered: '被过滤',
    failed: '读取失败',
  };
  return labelMap[status];
}

function previewStatusLabel(row: PreviewChange): string {
  if (row.status === 'failed') return statusLabel(row.status);
  if (row.ruleLabel === DATABASE_PLUGIN_RULE_LABEL) return DATABASE_PLUGIN_STATUS_TEXT;
  if (row.reviewNeeded) return '待确认';
  return statusLabel(row.status);
}

function createFailedRow(bookName: string, message: string): PreviewChange {
  return {
    id: `${bookName}:failed:${message}`,
    contentEditKey: `${bookName}:failed:${message}`,
    previewIndex: 0,
    originalIndex: Number.MAX_SAFE_INTEGER,
    promptRank: Number.MAX_SAFE_INTEGER,
    nextPromptRank: Number.MAX_SAFE_INTEGER,
    worldbook: bookName,
    uid: -1,
    uidText: '-',
    entryName: message,
    fromText: '-',
    toText: '-',
    nextEnabled: false,
    nextStrategyType: 'constant',
    nextPosition: createEmptyCustomDraftPosition(),
    nextProbability: 0,
    fromStateText: '-',
    toStateText: '-',
    fromTone: 'neutral',
    toTone: 'neutral',
    cacheZoneText: '-',
    strategyText: '-',
    orderText: '-',
    riskText: '-',
    ruleLabel: '-',
    status: 'failed',
    changed: false,
    reviewNeeded: false,
    decisionKey: null,
    entryAction: null,
    actionChoices: [],
    originalContent: '',
    content: '',
    contentLength: 0,
    contentEdited: false,
    tokenCount: 0,
    tokenIsEstimated: true,
    depthValue: Number.MAX_SAFE_INTEGER,
    orderValue: Number.MAX_SAFE_INTEGER,
    nextOrderValue: Number.MAX_SAFE_INTEGER,
    probability: 0,
    priorityValue: null,
    riskHits: [],
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function notifySuccess(message: string): void {
  if (window.toastr) window.toastr.success(message, '世界书缓存优化器');
}

function notifyInfo(message: string): void {
  if (window.toastr) window.toastr.info(message, '世界书缓存优化器');
}

function notifyError(message: string): void {
  if (window.toastr) window.toastr.error(message, '世界书缓存优化器');
}
</script>

<style scoped>
.wbm-settings,
.wbm-overlay,
.wbm-confirm {
  --wbm-bg: #111113;
  --wbm-surface: #1d1d20;
  --wbm-surface-raised: #2a2b2f;
  --wbm-surface-soft: #23252b;
  --wbm-border: #3a3b40;
  --wbm-border-soft: #303137;
  --wbm-text: #f4f4f5;
  --wbm-muted: #b7bac4;
  --wbm-blue: #4d6bfe;
  --wbm-blue-strong: #5f82ff;
  --wbm-blue-soft: rgba(77, 107, 254, 0.18);
  --wbm-blue-softer: rgba(77, 107, 254, 0.11);
  --wbm-radius-xl: 24px;
  --wbm-radius-lg: 18px;
  --wbm-radius-md: 14px;
  --wbm-radius-sm: 10px;
  --wbm-z-overlay: 30000;
  --wbm-z-modal: 31400;
}

.wbm-settings {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  flex-wrap: wrap;
}

.wbm-open-btn,
.wbm-primary-btn,
.wbm-small-btn,
.wbm-danger-btn,
.wbm-icon-btn {
  border: 1px solid var(--wbm-border);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1.3;
  text-shadow: none;
  -webkit-text-fill-color: currentColor;
}

.wbm-primary-btn {
  border-color: var(--wbm-blue);
  background: var(--wbm-blue);
  color: #ffffff;
}

.wbm-danger-btn {
  border-color: #ef4444;
  background: #b91c1c;
  color: #fff;
}

.wbm-open-btn:hover:not(:disabled),
.wbm-primary-btn:hover:not(:disabled),
.wbm-small-btn:hover:not(:disabled),
.wbm-danger-btn:hover:not(:disabled),
.wbm-icon-btn:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.wbm-open-btn:focus-visible,
.wbm-primary-btn:focus-visible,
.wbm-small-btn:focus-visible,
.wbm-danger-btn:focus-visible,
.wbm-icon-btn:focus-visible,
.wbm-input:focus-visible,
.wbm-select:focus-visible {
  outline: 2px solid var(--wbm-blue-strong);
  outline-offset: 2px;
}

.wbm-icon-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  flex: 0 0 auto;
}

button:disabled,
input:disabled,
select:disabled {
  cursor: not-allowed;
}

button:disabled {
  border-color: var(--wbm-border);
  background: #25262a;
  color: #9da3b3;
  filter: none;
  opacity: 1;
}

input:disabled,
select:disabled {
  opacity: 0.68;
}

.wbm-settings-hint,
.wbm-header p,
.wbm-empty {
  color: var(--wbm-muted);
  opacity: 1;
}

.wbm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  z-index: var(--wbm-z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  box-sizing: border-box;
}

.wbm-dialog {
  position: relative;
  width: min(1420px, 100%);
  height: min(960px, calc(var(--wbm-vvh, 100dvh) - 24px));
  max-height: min(960px, calc(var(--wbm-vvh, 100dvh) - 24px));
  box-sizing: border-box;
  background: var(--wbm-bg);
  color: var(--wbm-text);
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-xl);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
  display: block;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  color-scheme: dark;
}

.wbm-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--wbm-border-soft);
  background: rgba(17, 17, 19, 0.96);
  backdrop-filter: blur(18px);
}

.wbm-header > div:first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.wbm-header h2,
.wbm-panel-title h3,
.wbm-confirm-box h3 {
  margin: 0;
}

.wbm-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 0;
}

.wbm-header h2 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-version {
  color: var(--wbm-muted);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  opacity: 0.78;
}

.wbm-version-manager-btn {
  position: relative;
  border: 1px solid transparent;
  background: rgba(42, 43, 47, 0.62);
  color: var(--wbm-muted);
}

.wbm-version-manager-btn:hover {
  border-color: var(--wbm-border);
  color: var(--wbm-text);
  background: var(--wbm-surface-raised);
}

.wbm-version-manager-btn.available {
  border-color: rgba(95, 130, 255, 0.72);
  background: var(--wbm-blue-soft);
  color: #dce5ff;
  box-shadow: 0 0 0 3px rgba(77, 107, 254, 0.12);
}

.wbm-version-manager-btn.checking i {
  animation: wbm-spin 0.9s linear infinite;
}

.wbm-update-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #7dd3fc;
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.18);
}

@keyframes wbm-spin {
  to {
    transform: rotate(360deg);
  }
}

.wbm-header p {
  margin: 6px 0 0;
}

.wbm-header-actions {
  display: flex;
  align-items: center;
  align-self: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: nowrap;
}

.wbm-work-section {
  display: block;
  border-bottom: 1px solid var(--wbm-border-soft);
}

.wbm-work-section.collapsed {
  min-height: 0;
}

.wbm-work-section.expanded {
  min-height: 0;
}

.wbm-setup-section {
  min-height: 0;
}

.wbm-preview-shell {
  border-bottom: 0;
}

.wbm-section-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--wbm-border-soft);
  background: #17181b;
}

.wbm-section-toolbar h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.2;
}

.wbm-section-toolbar span {
  display: block;
  margin-top: 2px;
  opacity: 0.72;
  font-size: 12px;
}

.wbm-body {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(420px, 1fr);
  align-items: stretch;
  gap: 12px;
  padding: 12px;
  overflow: visible;
}

.wbm-panel {
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-lg);
  padding: 12px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  background: var(--wbm-surface);
}

.wbm-books-panel,
.wbm-rules-panel {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  overflow: visible;
}

.wbm-rules-panel {
  grid-column: 1;
  grid-row: 1;
}

.wbm-books-panel {
  grid-column: 2;
  grid-row: 1;
}

.wbm-panel-title,
.wbm-row-actions,
.wbm-preview-actions,
.wbm-dialog-actions,
.wbm-target-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wbm-panel-title {
  justify-content: space-between;
  margin-bottom: 10px;
}

.wbm-input,
.wbm-select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 9px 12px;
  border-radius: var(--wbm-radius-md);
  border: 1px solid var(--wbm-border);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  caret-color: var(--wbm-blue-strong);
  color-scheme: dark;
  text-shadow: none;
  -webkit-text-fill-color: var(--wbm-text);
  appearance: none;
}

.wbm-input.invalid {
  border-color: #ef4444;
  box-shadow: 0 0 0 1px #ef4444;
}

.wbm-input::placeholder {
  color: #9ea3b0;
  opacity: 1;
  -webkit-text-fill-color: #9ea3b0;
}

.wbm-input:-webkit-autofill,
.wbm-input:-webkit-autofill:focus {
  box-shadow: 0 0 0 1000px var(--wbm-surface-raised) inset;
  -webkit-text-fill-color: var(--wbm-text);
}

.wbm-select {
  padding-right: 28px;
  background-image:
    linear-gradient(45deg, transparent 50%, #dbe5ff 50%), linear-gradient(135deg, #dbe5ff 50%, transparent 50%);
  background-position:
    calc(100% - 17px) 50%,
    calc(100% - 11px) 50%;
  background-size:
    6px 6px,
    6px 6px;
  background-repeat: no-repeat;
}

.wbm-select option {
  background: #17181b;
  color: var(--wbm-text);
}

.wbm-row-actions {
  margin: 8px 0;
}

.wbm-book-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.wbm-book-controls label,
.wbm-compact-field {
  display: grid;
  gap: 3px;
  color: var(--wbm-muted);
  font-size: 12px;
}

.wbm-loading-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--wbm-blue-strong);
  font-size: 12px;
}

.wbm-book-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 216px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
  scrollbar-gutter: stable;
}

.wbm-check-row,
.wbm-toggle-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wbm-check-row {
  min-height: 34px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--wbm-radius-sm);
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.wbm-check-row.active-source {
  border-color: rgba(77, 107, 254, 0.22);
  background: var(--wbm-blue-softer);
}

.wbm-check-row.selected {
  border-color: rgba(77, 107, 254, 0.84);
  background: var(--wbm-blue-soft);
  box-shadow: inset 3px 0 0 var(--wbm-blue);
}

.wbm-check-row input,
.wbm-toggle-line input {
  accent-color: var(--wbm-blue);
}

.wbm-book-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-book-meta {
  flex: 0 1 auto;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wbm-muted);
  opacity: 0.68;
  font-size: 12px;
}

.wbm-inline-stat {
  color: var(--wbm-muted);
  font-size: 12px;
  font-weight: 700;
  opacity: 0.84;
}

.wbm-dedupe-body {
  grid-template-columns: minmax(300px, 360px) minmax(420px, 1fr);
}

.wbm-dedupe-body .wbm-books-panel {
  grid-column: 2;
}

.wbm-dedupe-rule-panel {
  grid-column: 1;
  grid-row: 1;
}

.wbm-dedupe-rules {
  display: grid;
  gap: 9px;
}

.wbm-dedupe-rules > div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: var(--wbm-radius-md);
  background: rgba(255, 255, 255, 0.04);
}

.wbm-dedupe-rules strong {
  font-size: 13px;
}

.wbm-dedupe-rules span {
  color: var(--wbm-muted);
  font-size: 12px;
  line-height: 1.45;
}

.wbm-risk-list {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.wbm-source-badge {
  flex: 0 1 auto;
  max-width: 58px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  padding: 1px 6px;
  color: var(--wbm-muted);
  font-size: 12px;
  line-height: 1.35;
  background: rgba(255, 255, 255, 0.04);
}

.wbm-source-badge.source-chat {
  border-color: rgba(74, 222, 128, 0.55);
  color: #dcfce7;
  background: rgba(22, 101, 52, 0.28);
}

.wbm-source-badge.source-character_primary {
  border-color: rgba(77, 107, 254, 0.58);
  color: #dbe5ff;
  background: var(--wbm-blue-soft);
}

.wbm-source-badge.source-character_additional {
  border-color: rgba(95, 130, 255, 0.5);
  color: #dbe5ff;
  background: var(--wbm-blue-softer);
}

.wbm-source-badge.source-global {
  border-color: rgba(251, 191, 36, 0.55);
  color: #fde68a;
  background: rgba(113, 63, 18, 0.24);
}

.wbm-risk-list span {
  border: 1px solid rgba(77, 107, 254, 0.38);
  border-radius: 999px;
  padding: 1px 6px;
  color: #dbe5ff;
  font-size: 12px;
  line-height: 1.4;
  background: var(--wbm-blue-softer);
}

.wbm-preset {
  display: grid;
  gap: 12px;
  overflow: visible;
  padding-right: 2px;
}

.wbm-mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.wbm-mode-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 54px;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  text-align: left;
  cursor: pointer;
}

.wbm-mode-option:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.wbm-mode-option.active {
  border-color: rgba(77, 107, 254, 0.78);
  background: var(--wbm-blue-soft);
  box-shadow: inset 3px 0 0 var(--wbm-blue);
}

.wbm-mode-option i {
  color: var(--wbm-blue-strong);
}

.wbm-mode-option span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.wbm-mode-option strong,
.wbm-mode-option small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-mode-option strong {
  font-size: 14px;
  line-height: 1.15;
}

.wbm-mode-option small {
  color: var(--wbm-muted);
  font-size: 12px;
  font-weight: 600;
}

.wbm-dedupe-strategy-switch {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.wbm-dedupe-strategy-switch .wbm-mode-option {
  grid-template-columns: auto auto;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 6px;
}

.wbm-dedupe-strategy-switch .wbm-mode-option.active {
  box-shadow: inset 0 3px 0 var(--wbm-blue);
}

.wbm-dedupe-strategy-switch .wbm-mode-option i {
  font-size: 14px;
}

.wbm-dedupe-strategy-switch .wbm-mode-option span {
  display: block;
}

.wbm-dedupe-strategy-switch .wbm-mode-option strong {
  font-size: 14px;
  white-space: nowrap;
}

.wbm-rule-map {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(77, 107, 254, 0.24);
  border-radius: var(--wbm-radius-lg);
  background: rgba(77, 107, 254, 0.06);
}

.wbm-rule-map-title,
.wbm-rule-flow-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
}

.wbm-rule-map-title {
  color: var(--wbm-muted);
  opacity: 0.7;
  font-size: 12px;
}

.wbm-rule-map-title span:last-child {
  grid-column: 3;
}

.wbm-flow-node {
  container-type: inline-size;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px;
  align-items: center;
  min-width: 0;
  min-height: 38px;
  padding: 7px 8px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: var(--wbm-radius-md);
  background: rgba(255, 255, 255, 0.04);
}

.wbm-flow-node strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
  font-size: 15px;
  font-size: clamp(12px, var(--flow-label-fit, 10cqw), 16px);
  line-height: 1.08;
  letter-spacing: 0;
}

.wbm-flow-node .wbm-action-dot {
  width: clamp(9px, 7cqw, 12px);
  height: clamp(9px, 7cqw, 12px);
}

.wbm-flow-node.tone-blue {
  border-color: rgba(77, 107, 254, 0.5);
  background: var(--wbm-blue-soft);
}

.wbm-flow-node.tone-green {
  border-color: rgba(74, 222, 128, 0.45);
  background: rgba(22, 101, 52, 0.16);
}

.wbm-flow-node.tone-orange {
  border-color: rgba(251, 191, 36, 0.48);
  background: rgba(113, 63, 18, 0.18);
}

.wbm-flow-node.tone-blue .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dbeafe 0 18%, #60a5fa 42%, #2563eb 100%);
}

.wbm-flow-node.tone-green .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dcfce7 0 18%, #4ade80 44%, #16a34a 100%);
}

.wbm-flow-node.tone-orange .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #fef3c7 0 18%, #f59e0b 44%, #b45309 100%);
}

.wbm-flow-arrow {
  display: inline-flex;
  justify-content: center;
  color: var(--wbm-blue-strong);
  opacity: 0.78;
}

.wbm-inline-alert {
  margin: 0;
}

.wbm-scope-note {
  margin: 0;
  color: var(--wbm-muted);
  opacity: 0.76;
  font-size: 13px;
}

.wbm-rule-controls,
.wbm-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.wbm-form-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.wbm-wide-field {
  grid-column: span 2;
}

.wbm-target-box {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--wbm-border-soft);
}

.wbm-target-box label {
  min-width: 160px;
  flex: 1 1 160px;
}

.wbm-alert {
  margin: 10px 12px 0;
  padding: 8px 10px;
  border-radius: var(--wbm-radius-md);
  border: 1px solid #d97706;
  background: rgba(217, 119, 6, 0.15);
}

.wbm-alert-error {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.16);
}

.wbm-preview {
  padding: 12px;
  display: block;
  overflow: visible;
}

.wbm-preview-actions {
  align-items: center;
  min-height: 58px;
  margin-bottom: 8px;
}

.wbm-preview-actions > .wbm-primary-btn,
.wbm-preview-actions > .wbm-small-btn,
.wbm-preview-actions .wbm-select {
  min-height: 42px;
}

.wbm-preview-actions > label.wbm-compact-field {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: 42px;
  min-height: 42px;
  margin: 0;
  white-space: nowrap;
}

.wbm-preview-actions > label.wbm-compact-field > .wbm-compact-label {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  height: 42px;
  padding-top: 1px;
  box-sizing: border-box;
  line-height: 42px;
}

.wbm-preview-actions .wbm-compact-field .wbm-select {
  width: 158px;
}

.wbm-preview-actions .wbm-compact-field:nth-of-type(2) .wbm-select {
  width: 206px;
}

.wbm-filter-stats {
  display: none;
}

.wbm-blue-token-stats {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 34px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid rgba(77, 107, 254, 0.28);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-blue-softer);
  color: var(--wbm-muted);
  font-size: 13px;
  font-weight: 700;
}

.wbm-blue-token-stats span,
.wbm-blue-token-stats strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.wbm-blue-token-stats.warning {
  border-color: rgba(239, 68, 68, 0.88);
  background: rgba(239, 68, 68, 0.18);
  color: #fecaca;
  box-shadow:
    0 0 0 1px rgba(239, 68, 68, 0.18),
    0 10px 26px rgba(127, 29, 29, 0.24);
}

.wbm-blue-token-stats.warning i,
.wbm-blue-token-stats.warning strong {
  color: #ffffff;
}

.wbm-risk-list {
  margin-bottom: 8px;
}

.wbm-content-preview {
  max-height: 190px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: #151518;
  color: var(--wbm-text);
  font: inherit;
  line-height: 1.55;
}

.wbm-content-preview mark,
.wbm-content-line mark {
  border-radius: 4px;
  padding: 0 2px;
  color: inherit;
}

.wbm-content-preview mark.risk-dynamic,
.wbm-content-line mark.risk-dynamic {
  background: rgba(248, 113, 113, 0.32);
  box-shadow: inset 0 -1px 0 rgba(248, 113, 113, 0.9);
}

.wbm-content-preview mark.risk-warning,
.wbm-content-line mark.risk-warning {
  background: rgba(251, 191, 36, 0.26);
  box-shadow: inset 0 -1px 0 rgba(251, 191, 36, 0.86);
}

.wbm-content-preview mark.risk-unknown,
.wbm-content-line mark.risk-unknown {
  background: rgba(77, 107, 254, 0.28);
  box-shadow: inset 0 -1px 0 rgba(95, 130, 255, 0.9);
}

.wbm-card-list {
  display: none;
}

.wbm-dedupe-preview .wbm-table-wrap {
  display: none;
}

.wbm-dedupe-actions {
  grid-template-columns: auto auto minmax(180px, 1fr);
}

.wbm-apply-results {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 10px;
}

.wbm-apply-results span {
  max-width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(34, 197, 94, 0.34);
  border-radius: var(--wbm-radius-sm);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-apply-results span.failed {
  border-color: rgba(248, 113, 113, 0.42);
  background: rgba(248, 113, 113, 0.14);
  color: #fecaca;
}

.wbm-dedupe-group-list {
  display: grid;
  gap: 10px;
}

.wbm-dedupe-group {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-lg);
  background: #17181b;
}

.wbm-dedupe-group.selected {
  border-color: rgba(77, 107, 254, 0.72);
  background: rgba(77, 107, 254, 0.08);
}

.wbm-dedupe-group.low {
  border-color: rgba(251, 191, 36, 0.34);
}

.wbm-dedupe-group.skipped {
  opacity: 0.82;
}

.wbm-dedupe-group-head,
.wbm-dedupe-keep-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wbm-dedupe-group-check {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  min-width: 0;
}

.wbm-dedupe-group-check input {
  margin-top: 2px;
  accent-color: var(--wbm-blue);
}

.wbm-dedupe-group-check span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.wbm-dedupe-group-check strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-dedupe-group-check small,
.wbm-dedupe-keep-row > span,
.wbm-dedupe-candidate p,
.wbm-dedupe-candidate small {
  color: var(--wbm-muted);
  font-size: 12px;
}

.wbm-dedupe-confidence {
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}

.wbm-dedupe-confidence.confidence-exact,
.wbm-dedupe-confidence.confidence-high {
  border-color: rgba(34, 197, 94, 0.38);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.wbm-dedupe-confidence.confidence-medium {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(96, 165, 250, 0.12);
  color: #dbeafe;
}

.wbm-dedupe-confidence.confidence-low {
  border-color: rgba(251, 191, 36, 0.42);
  background: rgba(251, 191, 36, 0.12);
  color: #fde68a;
}

.wbm-dedupe-keep-row label {
  display: grid;
  grid-template-columns: auto minmax(220px, 320px);
  align-items: center;
  gap: 8px;
  color: var(--wbm-muted);
  font-size: 12px;
}

.wbm-dedupe-warning-line {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border: 1px solid rgba(251, 191, 36, 0.26);
  border-radius: var(--wbm-radius-md);
  background: rgba(251, 191, 36, 0.08);
  color: #fde68a;
  font-size: 12px;
}

.wbm-dedupe-candidates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.wbm-dedupe-candidate {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: var(--wbm-radius-md);
  background: rgba(255, 255, 255, 0.035);
}

.wbm-dedupe-candidate.keep {
  border-color: rgba(34, 197, 94, 0.34);
  background: rgba(34, 197, 94, 0.08);
}

.wbm-dedupe-candidate.remove {
  border-color: rgba(248, 113, 113, 0.22);
}

.wbm-dedupe-candidate > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.wbm-dedupe-candidate strong,
.wbm-dedupe-candidate span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-dedupe-candidate span {
  flex: 0 1 auto;
  color: #dbe5ff;
  font-size: 12px;
  font-weight: 700;
}

.wbm-dedupe-candidate p {
  margin: 0;
}

.wbm-table-wrap {
  overflow-x: auto;
  overflow-y: visible;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-lg);
  background: #17181b;
}

.wbm-table {
  width: 100%;
  min-width: 1080px;
  border-collapse: collapse;
  table-layout: fixed;
}

.wbm-col-entry {
  width: 27%;
}

.wbm-col-before {
  width: 16%;
}

.wbm-col-after {
  width: 22%;
}

.wbm-col-order {
  width: 8%;
}

.wbm-col-risk {
  width: 18%;
}

.wbm-col-status {
  width: 9%;
}

.wbm-table th,
.wbm-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--wbm-border-soft);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.wbm-table th {
  background: #232429;
  color: #dbe5ff;
}

.wbm-table-head-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.wbm-table-head-main small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wbm-muted);
  opacity: 0.68;
  font-size: 12px;
  font-weight: 500;
}

.wbm-entry-cell,
.wbm-action-cell,
.wbm-position-cell {
  min-width: 0;
}

.wbm-entry-cell strong,
.wbm-entry-cell small,
.wbm-action-cell span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-entry-cell small {
  margin-top: 3px;
  opacity: 0.72;
  font-size: 12px;
}

.wbm-action-cell .wbm-select {
  height: 42px;
  width: 100%;
  padding-top: 0;
  padding-bottom: 0;
  line-height: 42px;
}

.wbm-action-select {
  border-radius: var(--wbm-radius-md);
  font-weight: 700;
  font-size: 14px;
  color: var(--wbm-text);
}

.wbm-action-select.tone-blue {
  border-color: rgba(77, 107, 254, 0.68);
  background-color: rgba(77, 107, 254, 0.18);
}

.wbm-action-select.tone-green {
  border-color: rgba(74, 222, 128, 0.58);
  background-color: rgba(22, 101, 52, 0.22);
}

.wbm-action-select.tone-orange {
  border-color: rgba(251, 191, 36, 0.62);
  background-color: rgba(113, 63, 18, 0.24);
}

.wbm-action-select.tone-disabled {
  border-color: rgba(248, 113, 113, 0.56);
  background-color: rgba(127, 29, 29, 0.22);
}

.wbm-action-select.tone-neutral {
  border-color: rgba(148, 163, 184, 0.32);
  background-color: var(--wbm-surface-raised);
}

.wbm-action-stack {
  display: grid;
  gap: 0;
  min-width: 0;
}

.wbm-action-display {
  display: grid;
  grid-template-columns: auto minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 7px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
}

.wbm-action-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #94a3b8;
  box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.16);
}

.wbm-action-label,
.wbm-action-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-action-label {
  font-weight: 700;
}

.wbm-action-detail {
  opacity: 0.82;
}

.wbm-action-display.tone-blue {
  border-color: rgba(77, 107, 254, 0.58);
  background: var(--wbm-blue-soft);
}

.wbm-action-display.tone-blue .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dbe5ff 0 18%, #6b8cff 42%, #4d6bfe 100%);
  box-shadow:
    0 0 0 2px rgba(77, 107, 254, 0.2),
    0 0 14px rgba(77, 107, 254, 0.42);
}

.wbm-action-display.tone-green {
  border-color: rgba(74, 222, 128, 0.5);
  background: rgba(22, 101, 52, 0.16);
}

.wbm-action-display.tone-green .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dcfce7 0 18%, #4ade80 44%, #16a34a 100%);
  box-shadow:
    0 0 0 2px rgba(74, 222, 128, 0.18),
    0 0 14px rgba(74, 222, 128, 0.34);
}

.wbm-action-display.tone-orange {
  border-color: rgba(251, 191, 36, 0.52);
  background: rgba(113, 63, 18, 0.18);
}

.wbm-action-display.tone-orange .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #fef3c7 0 18%, #f59e0b 44%, #b45309 100%);
  box-shadow:
    0 0 0 2px rgba(245, 158, 11, 0.18),
    0 0 14px rgba(245, 158, 11, 0.34);
}

.wbm-action-display.tone-disabled {
  border-color: rgba(248, 113, 113, 0.46);
  background: rgba(127, 29, 29, 0.18);
}

.wbm-action-display.tone-gray {
  border-color: rgba(148, 163, 184, 0.46);
  background: rgba(51, 65, 85, 0.22);
}

.wbm-action-display.tone-disabled .wbm-action-dot {
  background: #f87171;
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.18);
}

.wbm-action-display.tone-gray .wbm-action-dot {
  background: #94a3b8;
  box-shadow: 0 0 0 2px rgba(148, 163, 184, 0.18);
}

.wbm-action-display.tone-edit {
  border-color: rgba(77, 107, 254, 0.52);
  background: var(--wbm-blue-soft);
}

.wbm-action-display.tone-edit .wbm-action-dot {
  background: var(--wbm-blue-strong);
  box-shadow:
    0 0 0 2px rgba(77, 107, 254, 0.18),
    0 0 14px rgba(77, 107, 254, 0.34);
}

.wbm-state-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  gap: 6px;
  padding: 4px 7px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-state-pill.tone-blue {
  border-color: rgba(77, 107, 254, 0.58);
  background: var(--wbm-blue-soft);
}

.wbm-state-pill.tone-green {
  border-color: rgba(74, 222, 128, 0.5);
  background: rgba(22, 101, 52, 0.16);
}

.wbm-state-pill.tone-gray {
  border-color: rgba(148, 163, 184, 0.46);
  background: rgba(51, 65, 85, 0.22);
}

.wbm-state-pill.tone-blue .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dbe5ff 0 18%, #6b8cff 42%, #4d6bfe 100%);
}

.wbm-state-pill.tone-green .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dcfce7 0 18%, #4ade80 44%, #16a34a 100%);
}

.wbm-state-pill.tone-gray .wbm-action-dot {
  background: #94a3b8;
}

.wbm-risk-cell {
  min-width: 0;
}

.wbm-risk-line,
.wbm-risk-list {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.wbm-risk-line {
  flex-wrap: nowrap;
  overflow: hidden;
  white-space: nowrap;
}

.wbm-risk-list {
  flex-wrap: wrap;
}

.wbm-risk-line span,
.wbm-risk-list span {
  border: 1px solid rgba(77, 107, 254, 0.38);
  border-radius: 999px;
  padding: 1px 6px;
  color: #dbe5ff;
  font-size: 12px;
  line-height: 1.4;
  background: var(--wbm-blue-softer);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-risk-line span {
  flex: 0 1 auto;
}

.wbm-risk-line .risk-none {
  flex: 0 0 auto;
}

.wbm-risk-cell .risk-dynamic,
.wbm-risk-list .risk-dynamic {
  border-color: rgba(248, 113, 113, 0.72);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.34);
}

.wbm-risk-cell .risk-warning,
.wbm-risk-list .risk-warning {
  border-color: rgba(251, 191, 36, 0.7);
  color: #fde68a;
  background: rgba(113, 63, 18, 0.32);
}

.wbm-risk-cell .risk-unknown,
.wbm-risk-list .risk-unknown {
  border-color: rgba(77, 107, 254, 0.74);
  color: #dbe5ff;
  background: var(--wbm-blue-soft);
}

.wbm-risk-cell .risk-none,
.wbm-risk-list .risk-none {
  border-color: rgba(148, 163, 184, 0.45);
  color: var(--wbm-muted);
  background: rgba(255, 255, 255, 0.04);
}

.wbm-content-cell {
  min-width: 0;
}

.wbm-content-stack {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  min-width: 0;
}

.wbm-entry-title {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.wbm-entry-title strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-icon-inline {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 999px;
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  cursor: pointer;
  -webkit-text-fill-color: currentColor;
}

.wbm-entry-title .wbm-icon-inline {
  width: 20px;
  height: 20px;
  border-color: transparent;
  background: transparent;
  color: var(--wbm-blue-strong);
}

.wbm-icon-inline:hover {
  border-color: var(--wbm-blue-strong);
  color: #dbe5ff;
}

.wbm-icon-inline:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.wbm-content-line {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wbm-text);
}

.wbm-expanded-row td {
  padding: 0;
  overflow: visible;
  white-space: normal;
  background: #151518;
}

.wbm-expanded-row .wbm-content-preview {
  max-height: 300px;
  margin: 8px;
}

.wbm-content-editor {
  display: grid;
  gap: 8px;
  margin: 8px;
  padding: 10px;
  border: 1px solid rgba(77, 107, 254, 0.36);
  border-radius: var(--wbm-radius-lg);
  background: #17181b;
}

.wbm-textarea {
  width: 100%;
  min-height: 180px;
  max-height: 45vh;
  resize: vertical;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  caret-color: var(--wbm-blue-strong);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color-scheme: dark;
}

.wbm-textarea:focus {
  border-color: var(--wbm-blue-strong);
  outline: none;
  box-shadow: 0 0 0 2px rgba(77, 107, 254, 0.22);
}

.wbm-table .state-changed td {
  color: var(--wbm-text);
}

.wbm-table .state-changed .wbm-entry-cell strong,
.wbm-table .state-changed td:last-child {
  color: #8ea7ff;
}

.wbm-table .state-unchanged td {
  opacity: 0.75;
}

.wbm-table .state-failed td {
  color: #fca5a5;
}

.wbm-confirm {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.64);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  z-index: var(--wbm-z-modal);
}

.wbm-confirm-box {
  width: min(420px, 100%);
  max-height: calc(var(--wbm-vvh, 100dvh) - 32px);
  overflow: auto;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-lg);
  padding: 16px;
  background: var(--wbm-surface);
}

.wbm-confirm-option {
  margin: 12px 0 4px;
  color: var(--wbm-muted);
  font-weight: 700;
}

.wbm-version-box {
  width: min(560px, 100%);
  display: grid;
  gap: 8px;
  padding: 14px;
}

.wbm-version-box-header,
.wbm-version-actions,
.wbm-version-result {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wbm-version-box-header {
  justify-content: space-between;
}

.wbm-version-box-header p {
  margin: 2px 0 0;
  color: var(--wbm-muted);
  opacity: 0.82;
  font-size: 13px;
}

.wbm-version-close {
  width: 36px;
  height: 36px;
}

.wbm-version-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.wbm-version-summary > div,
.wbm-version-confirm-card,
.wbm-version-result,
.wbm-version-hint {
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-surface-raised);
}

.wbm-version-summary > div {
  padding: 8px 10px;
}

.wbm-version-summary span,
.wbm-version-confirm-card span {
  display: block;
  color: var(--wbm-muted);
  font-size: 12px;
}

.wbm-version-summary strong,
.wbm-version-confirm-card strong {
  display: block;
  margin-top: 2px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.wbm-version-hint {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  color: var(--wbm-muted);
  line-height: 1.4;
  font-size: 13px;
}

.wbm-version-hint.info {
  border-color: rgba(77, 107, 254, 0.46);
  background: var(--wbm-blue-softer);
  color: #dbe5ff;
}

.wbm-version-hint.warning {
  border-color: rgba(251, 191, 36, 0.42);
  background: rgba(113, 63, 18, 0.18);
}

.wbm-version-source {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: var(--wbm-radius-md);
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.035);
}

.wbm-version-source-field,
.wbm-version-source-custom {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.wbm-version-source-field > span,
.wbm-version-source-custom > span {
  color: var(--wbm-muted);
  font-size: 12px;
  font-weight: 800;
}

.wbm-version-source p {
  margin: 0;
  color: var(--wbm-muted);
  line-height: 1.4;
  font-size: 13px;
}

.wbm-version-source-help code,
.wbm-version-source-error code {
  border-radius: 6px;
  padding: 1px 5px;
  background: rgba(0, 0, 0, 0.22);
  color: #dbe5ff;
}

.wbm-version-source-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: #facc15 !important;
}

.wbm-version-actions {
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.wbm-version-confirm-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border-color: rgba(77, 107, 254, 0.52);
  background: var(--wbm-blue-softer);
}

.wbm-version-target-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.wbm-version-target-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  min-width: 0;
}

.wbm-version-target-meta span {
  min-width: 0;
}

.wbm-version-target-meta strong {
  display: inline;
  margin-left: 4px;
}

.wbm-version-target-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.wbm-version-target-actions .wbm-small-btn,
.wbm-version-target-actions .wbm-danger-btn {
  min-height: 38px;
  padding: 0 10px;
}

.wbm-version-confirm-card code,
.wbm-version-result code {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: var(--wbm-radius-sm);
  padding: 7px 8px;
  background: rgba(0, 0, 0, 0.22);
  color: #dbe5ff;
  white-space: nowrap;
  font-size: 13px;
}

.wbm-version-result {
  justify-content: space-between;
  padding: 10px;
}

.wbm-version-result .wbm-small-btn {
  flex: 0 0 auto;
  min-width: 72px;
  white-space: nowrap;
}

.wbm-version-result > div {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.wbm-version-result.success {
  border-color: rgba(74, 222, 128, 0.45);
  background: rgba(22, 101, 52, 0.2);
}

.wbm-version-result.warning {
  border-color: rgba(251, 191, 36, 0.46);
  background: rgba(113, 63, 18, 0.18);
}

.wbm-version-list {
  display: grid;
  gap: 6px;
  max-height: min(310px, calc(var(--wbm-vvh, 100dvh) - 370px));
  overflow: auto;
  padding-right: 2px;
}

.wbm-version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  min-height: 46px;
  padding: 8px 10px;
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  cursor: pointer;
  text-align: left;
}

.wbm-version-row:hover:not(:disabled) {
  border-color: rgba(95, 130, 255, 0.56);
  background: rgba(77, 107, 254, 0.13);
}

.wbm-version-row span {
  font-weight: 800;
}

.wbm-version-row em {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--wbm-muted);
  font-style: normal;
  font-size: 12px;
  white-space: nowrap;
}

.wbm-version-row.newer em {
  border-color: rgba(77, 107, 254, 0.5);
  color: #bdd0ff;
}

.wbm-version-row.older em {
  border-color: rgba(251, 191, 36, 0.4);
  color: #facc15;
}

.wbm-version-row.current {
  cursor: default;
}

.wbm-optimizer-settings-box {
  width: min(620px, 100%);
  display: grid;
  gap: 12px;
}

.wbm-optimizer-settings-group {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: var(--wbm-radius-md);
  padding: 10px;
  background: rgba(255, 255, 255, 0.035);
}

.wbm-optimizer-settings-group h4 {
  margin: 0;
  font-size: 14px;
}

.wbm-settings-choice-list {
  display: grid;
  gap: 8px;
}

.wbm-settings-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 8px;
  min-height: 48px;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: var(--wbm-radius-md);
  background: var(--wbm-surface-raised);
  color: var(--wbm-text);
  cursor: pointer;
}

.wbm-settings-choice.active {
  border-color: rgba(77, 107, 254, 0.72);
  background: var(--wbm-blue-soft);
}

.wbm-settings-choice input {
  margin-top: 3px;
}

.wbm-settings-choice span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.wbm-settings-choice strong,
.wbm-settings-choice small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wbm-settings-choice strong {
  line-height: 1.2;
}

.wbm-settings-choice small {
  color: var(--wbm-muted);
  font-size: 12px;
  line-height: 1.35;
}

.wbm-optimizer-settings-box .wbm-dialog-actions {
  justify-content: space-between;
}

.wbm-token-warning-box {
  border-color: rgba(239, 68, 68, 0.78);
  box-shadow: 0 24px 80px rgba(127, 29, 29, 0.28);
}

.wbm-token-warning-box h3 {
  color: #fca5a5;
}

.wbm-rule-help-box {
  width: min(640px, 100%);
}

.wbm-rule-help-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.wbm-rule-help-head h3,
.wbm-rule-help-head p {
  margin: 0;
}

.wbm-rule-help-head p {
  margin-top: 4px;
  color: var(--wbm-muted);
  opacity: 0.72;
}

.wbm-rule-help-list {
  display: grid;
  gap: 10px;
}

.wbm-rule-help-card {
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  padding: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.wbm-rule-help-card.tone-blue {
  border-color: rgba(77, 107, 254, 0.46);
}

.wbm-rule-help-card.tone-green {
  border-color: rgba(74, 222, 128, 0.42);
}

.wbm-rule-help-card.tone-orange {
  border-color: rgba(251, 191, 36, 0.46);
}

.wbm-rule-help-title {
  display: grid;
  grid-template-columns: auto minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wbm-rule-help-title strong,
.wbm-rule-help-title small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-rule-help-title small {
  color: var(--wbm-muted);
  opacity: 0.76;
}

.wbm-rule-help-card p,
.wbm-rule-help-note {
  color: var(--wbm-muted);
  opacity: 0.82;
  line-height: 1.55;
}

.wbm-rule-help-card p {
  margin: 8px 0 0;
}

.wbm-rule-help-note {
  margin: 12px 0 0;
}

.wbm-rule-help-card.tone-blue .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dbe5ff 0 18%, #6b8cff 42%, #4d6bfe 100%);
  box-shadow:
    0 0 0 2px rgba(77, 107, 254, 0.2),
    0 0 14px rgba(77, 107, 254, 0.42);
}

.wbm-rule-help-card.tone-green .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #dcfce7 0 18%, #4ade80 44%, #16a34a 100%);
  box-shadow:
    0 0 0 2px rgba(74, 222, 128, 0.18),
    0 0 14px rgba(74, 222, 128, 0.34);
}

.wbm-rule-help-card.tone-orange .wbm-action-dot {
  background: radial-gradient(circle at 35% 30%, #fef3c7 0 18%, #f59e0b 44%, #b45309 100%);
  box-shadow:
    0 0 0 2px rgba(245, 158, 11, 0.18),
    0 0 14px rgba(245, 158, 11, 0.34);
}

.wbm-custom-editor-box {
  width: min(760px, 100%);
  padding: 0;
  overflow: hidden;
  border-color: rgba(77, 107, 254, 0.42);
  background: radial-gradient(circle at 18% 0%, rgba(77, 107, 254, 0.18), transparent 34%), var(--wbm-bg);
}

.wbm-custom-editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--wbm-border-soft);
  background: rgba(23, 24, 27, 0.92);
}

.wbm-custom-editor-head h3,
.wbm-custom-editor-head p {
  margin: 0;
}

.wbm-custom-editor-head p {
  margin-top: 4px;
  color: var(--wbm-muted);
  opacity: 0.78;
}

.wbm-custom-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wbm-border-soft);
  color: var(--wbm-muted);
}

.wbm-custom-summary .wbm-state-pill {
  max-width: min(320px, 44%);
}

.wbm-custom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 16px;
}

.wbm-custom-editor-box .wbm-dialog-actions {
  margin-top: 0;
  padding: 0 16px 16px;
}

.wbm-custom-field {
  display: grid;
  gap: 7px;
  min-width: 0;
  color: var(--wbm-muted);
  font-size: 13px;
  font-weight: 700;
}

.wbm-custom-field-wide {
  grid-column: 1 / -1;
}

.wbm-custom-field.muted {
  opacity: 0.6;
}

.wbm-segmented-control {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--wbm-border);
  border-radius: var(--wbm-radius-md);
  background: rgba(0, 16, 28, 0.72);
}

.wbm-segmented-control button {
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--wbm-muted);
  cursor: pointer;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.wbm-segmented-control button.active {
  border-color: rgba(77, 107, 254, 0.65);
  background: var(--wbm-blue-soft);
  color: var(--wbm-text);
}

.wbm-action-dot.tone-blue {
  background: radial-gradient(circle at 35% 30%, #dbe5ff 0 18%, #6b8cff 42%, #4d6bfe 100%);
  box-shadow:
    0 0 0 2px rgba(77, 107, 254, 0.2),
    0 0 14px rgba(77, 107, 254, 0.42);
}

.wbm-action-dot.tone-green {
  background: radial-gradient(circle at 35% 30%, #dcfce7 0 18%, #4ade80 44%, #16a34a 100%);
  box-shadow:
    0 0 0 2px rgba(74, 222, 128, 0.18),
    0 0 14px rgba(74, 222, 128, 0.34);
}

.wbm-conflict-box {
  width: min(680px, 100%);
}

.wbm-conflict-box ul {
  margin: 8px 0;
  padding-left: 20px;
}

.wbm-dialog-actions {
  justify-content: flex-end;
  margin-top: 12px;
}

.wbm-structure-modal {
  position: fixed;
  inset: 0;
  z-index: var(--wbm-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(8, 9, 12, 0.74);
  backdrop-filter: blur(10px);
}

.wbm-structure-box {
  width: min(1120px, calc(100vw - 32px));
  max-height: calc(var(--wbm-vvh, 100dvh) - 32px);
  overflow: auto;
  border: 1px solid rgba(80, 86, 104, 0.72);
  border-radius: var(--wbm-radius-xl);
  background: #1f2024;
  color: var(--wbm-text);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.58);
}

.wbm-structure-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(68, 72, 86, 0.72);
  background: rgba(31, 32, 36, 0.96);
  backdrop-filter: blur(16px);
}

.wbm-structure-head h3,
.wbm-structure-head p,
.wbm-stack-visual h4 {
  margin: 0;
}

.wbm-structure-head p {
  margin-top: 4px;
  opacity: 0.72;
}

.wbm-structure-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.wbm-structure-toggle {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: 1px solid rgba(80, 86, 104, 0.72);
  border-radius: 999px;
  background: rgba(34, 35, 40, 0.92);
}

.wbm-structure-toggle button {
  border: 0;
  border-radius: 999px;
  padding: 7px 12px;
  background: transparent;
  color: var(--wbm-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.wbm-structure-toggle button.active {
  background: rgba(77, 107, 254, 0.22);
  color: var(--wbm-blue-ink);
  box-shadow: inset 0 0 0 1px rgba(92, 124, 255, 0.64);
}

.wbm-structure-diagram {
  --structure-title-space: 40px;
  position: relative;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(160px, 0.52fr) minmax(260px, 1fr);
  gap: 18px;
  padding: 16px;
  min-height: 520px;
  align-items: stretch;
}

.wbm-stack-visual,
.wbm-structure-empty {
  min-width: 0;
}

.wbm-stack-visual {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-rows: var(--structure-title-space) minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}

.wbm-stack-visual h4 {
  align-self: center;
  justify-self: center;
  text-align: center;
}

.wbm-structure-empty {
  display: grid;
  gap: 10px;
}

.wbm-before-stack {
  grid-column: 1;
}

.wbm-after-stack {
  grid-column: 3;
}

.wbm-cylinder {
  position: relative;
  height: 100%;
  min-height: 360px;
  padding: 0 12px;
  border: 1px solid rgba(77, 107, 254, 0.3);
  border-radius: 28px;
  background: #23242a;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 18px 42px rgba(0, 0, 0, 0.22);
}

.wbm-cylinder-layer {
  position: absolute;
  top: var(--layer-top);
  left: 12px;
  right: 12px;
  height: var(--layer-height);
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(92, 124, 255, 0.34);
  border-radius: 18px;
  background: #2a2d3f;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    color 140ms ease,
    opacity 140ms ease,
    box-shadow 140ms ease;
}

.wbm-cylinder-layer.is-interactive {
  cursor: pointer;
}

.wbm-cylinder-layer.is-interactive:hover,
.wbm-cylinder-layer.is-highlighted {
  border-color: rgba(92, 124, 255, 0.86);
  background: #334066;
  box-shadow:
    0 0 0 1px rgba(92, 124, 255, 0.22),
    0 12px 30px rgba(0, 0, 0, 0.24);
}

.wbm-cylinder-layer.is-dimmed {
  border-color: rgba(92, 98, 116, 0.38);
  background: #24262d;
  color: rgba(244, 244, 245, 0.46);
  opacity: 0.46;
}

.wbm-cylinder-layer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wbm-structure-svg {
  position: absolute;
  inset: var(--structure-title-space) 16px 16px;
  z-index: 3;
  width: calc(100% - 32px);
  height: calc(100% - var(--structure-title-space) - 16px);
  pointer-events: none;
  overflow: visible;
}

.wbm-structure-path {
  fill: none;
  stroke: rgba(92, 124, 255, 0.86);
  stroke-width: var(--arrow-width);
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 6px rgba(77, 107, 254, 0.28));
  transition:
    opacity 140ms ease,
    stroke 140ms ease,
    stroke-width 140ms ease,
    filter 140ms ease;
}

.wbm-structure-arrow-head {
  fill: rgba(92, 124, 255, 0.9);
  filter: drop-shadow(0 0 6px rgba(77, 107, 254, 0.28));
  transition:
    opacity 140ms ease,
    fill 140ms ease,
    filter 140ms ease;
}

.wbm-structure-path.is-unchanged {
  stroke: rgba(133, 146, 184, 0.48);
  filter: none;
}

.wbm-structure-arrow-head.is-unchanged {
  fill: rgba(133, 146, 184, 0.48);
  filter: none;
}

.wbm-structure-path.is-highlighted {
  stroke: rgba(92, 124, 255, 1);
  filter: drop-shadow(0 0 8px rgba(77, 107, 254, 0.42));
}

.wbm-structure-arrow-head.is-highlighted {
  fill: rgba(92, 124, 255, 1);
  filter: drop-shadow(0 0 8px rgba(77, 107, 254, 0.42));
}

.wbm-structure-path.is-dimmed {
  stroke: rgba(126, 133, 154, 0.26);
  opacity: 0.34;
  filter: none;
}

.wbm-structure-arrow-head.is-dimmed {
  fill: rgba(126, 133, 154, 0.26);
  opacity: 0.34;
  filter: none;
}

.wbm-structure-labels {
  position: absolute;
  inset: var(--structure-title-space) 16px 16px;
  z-index: 4;
  pointer-events: none;
}

.wbm-structure-count {
  position: absolute;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid rgba(92, 124, 255, 0.64);
  border-radius: 999px;
  background: rgba(42, 52, 82, 0.92);
  color: #dbe5ff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);
  transition:
    opacity 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease,
    color 140ms ease;
}

.wbm-structure-count.is-unchanged {
  border-color: rgba(133, 146, 184, 0.42);
  background: rgba(44, 49, 62, 0.88);
  color: #c2cadb;
}

.wbm-structure-count.is-highlighted {
  border-color: rgba(92, 124, 255, 0.92);
  background: #334066;
  color: #eef3ff;
}

.wbm-structure-count.is-dimmed {
  border-color: rgba(126, 133, 154, 0.28);
  background: rgba(38, 41, 50, 0.82);
  color: rgba(194, 202, 219, 0.5);
  opacity: 0.46;
}

.wbm-structure-empty {
  grid-column: 2;
  align-self: center;
  justify-self: center;
  padding: 8px 12px;
  border: 1px solid rgba(92, 124, 255, 0.28);
  border-radius: 8px;
  background: rgba(35, 37, 43, 0.72);
}

@media (max-width: 760px) {
  .wbm-overlay {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
  }

  .wbm-dialog {
    width: 100dvw;
    height: var(--wbm-vvh, 100dvh);
    max-height: none;
    border: 0;
    border-radius: 0;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    box-shadow: none;
    overflow: auto;
  }

  .wbm-setup-section {
    min-height: 0;
  }

  .wbm-preview-shell {
    min-height: 0;
  }

  .wbm-section-toolbar {
    padding: 8px 10px;
  }

  .wbm-section-toolbar h3 {
    font-size: 15px;
  }

  .wbm-body {
    grid-template-columns: 1fr;
    padding: 10px;
    overflow: visible;
  }

  .wbm-panel {
    height: auto;
  }

  .wbm-rules-panel,
  .wbm-books-panel {
    grid-column: auto;
    grid-row: auto;
  }

  .wbm-rules-panel {
    order: 1;
  }

  .wbm-books-panel {
    order: 2;
  }

  .wbm-book-controls {
    grid-template-columns: 1fr;
  }

  .wbm-rule-controls,
  .wbm-form-grid,
  .wbm-backup-card {
    grid-template-columns: 1fr;
  }

  .wbm-mode-switch {
    grid-template-columns: 1fr;
  }

  .wbm-mode-option {
    min-height: 48px;
  }

  .wbm-dedupe-strategy-switch {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .wbm-dedupe-strategy-switch .wbm-mode-option {
    min-height: 42px;
    padding: 7px 4px;
  }

  .wbm-dedupe-strategy-switch .wbm-mode-option i {
    display: none;
  }

  .wbm-rule-map-title,
  .wbm-rule-flow-row {
    grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr);
    gap: 6px;
  }

  .wbm-flow-node {
    padding: 5px 6px;
    min-height: 34px;
  }

  .wbm-flow-node strong {
    font-size: 12px;
    font-size: clamp(10px, var(--flow-label-fit, 9cqw), 14px);
  }

  .wbm-wide-field {
    grid-column: auto;
  }

  .wbm-header {
    padding: 10px 12px;
  }

  .wbm-header-actions {
    gap: 7px;
  }

  .wbm-header h2 {
    font-size: 20px;
  }

  .wbm-header-actions .wbm-icon-btn,
  .wbm-version-manager-btn {
    width: 44px;
    height: 44px;
  }

  .wbm-header p {
    font-size: 13px;
  }

  .wbm-version-box {
    width: 100%;
    max-height: calc(var(--wbm-vvh, 100dvh) - 20px);
    padding: 10px;
  }

  .wbm-version-summary {
    grid-template-columns: 1fr;
  }

  .wbm-version-source-field,
  .wbm-version-source-custom {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .wbm-version-actions {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 8px;
  }

  .wbm-version-actions .wbm-primary-btn,
  .wbm-version-actions .wbm-small-btn {
    min-height: 44px;
  }

  .wbm-version-result {
    align-items: stretch;
    flex-direction: column;
  }

  .wbm-version-target-head {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .wbm-version-target-meta {
    gap: 4px 12px;
  }

  .wbm-version-target-actions {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1.4fr);
    gap: 6px;
  }

  .wbm-version-target-actions .wbm-small-btn,
  .wbm-version-target-actions .wbm-danger-btn {
    width: 100%;
    min-width: 0;
    min-height: 42px;
    padding: 0 8px;
  }

  .wbm-version-list {
    max-height: min(300px, calc(var(--wbm-vvh, 100dvh) - 460px));
  }

  .wbm-book-list {
    max-height: 220px;
    min-height: 120px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .wbm-preview {
    padding: 8px 10px 10px;
  }

  .wbm-row-actions {
    gap: 6px;
  }

  .wbm-preview-actions {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    align-items: stretch;
    gap: 8px;
    min-height: auto;
    margin: 0 0 10px;
    padding: 8px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 18px;
    background: rgba(14, 15, 19, 0.72);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .wbm-preview-actions > .wbm-primary-btn,
  .wbm-preview-actions > .wbm-small-btn {
    width: 100%;
    min-width: 0;
    min-height: 46px;
    padding: 0 8px;
    gap: 5px;
    font-size: 15px;
    line-height: 1;
    touch-action: manipulation;
  }

  .wbm-preview-actions > .wbm-generate-action {
    grid-column: span 3;
    border-radius: 18px;
    box-shadow:
      0 10px 24px rgba(77, 107, 254, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }

  .wbm-preview-actions > .wbm-apply-action {
    grid-column: span 2;
    border-color: rgba(93, 122, 255, 0.45);
    background: rgba(77, 107, 254, 0.18);
    color: #e7ecff;
    box-shadow: none;
  }

  .wbm-preview-actions > .wbm-structure-action {
    grid-column: span 1;
    min-width: 0;
    padding: 0;
    border-radius: 16px;
    font-size: 0;
  }

  .wbm-preview-actions > .wbm-structure-action i {
    margin: 0;
    font-size: 20px;
  }

  .wbm-preview-actions.speed-mode > .wbm-primary-btn,
  .wbm-preview-actions.speed-mode > .wbm-small-btn {
    grid-column: span 3;
  }

  .wbm-preview-actions .wbm-compact-field {
    grid-column: span 3;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 4px;
    height: 42px;
    min-height: 42px;
    min-width: 0;
    padding: 0 8px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 15px;
    background: rgba(255, 255, 255, 0.045);
    box-sizing: border-box;
    touch-action: manipulation;
  }

  .wbm-preview-actions .wbm-compact-field .wbm-select,
  .wbm-preview-actions .wbm-compact-field:nth-of-type(2) .wbm-select {
    width: 100%;
    min-width: 0;
    height: 40px;
    min-height: 40px;
    padding: 0 22px 0 4px;
    border: 0;
    border-radius: 0;
    background-color: transparent;
    box-shadow: none;
    font-size: 15px;
    font-weight: 700;
  }

  .wbm-preview-actions > label.wbm-compact-field > .wbm-compact-label {
    align-self: center;
    height: auto;
    min-width: 0;
    padding: 0;
    line-height: 1;
    color: rgba(164, 169, 182, 0.9);
    font-size: 12px;
    font-weight: 700;
  }

  .wbm-filter-stats {
    display: block;
    grid-column: 1 / -1;
    padding: 6px 8px;
    border: 1px solid rgba(77, 107, 254, 0.28);
    border-radius: var(--wbm-radius-md);
    color: var(--wbm-muted);
    background: var(--wbm-blue-softer);
    font-size: 12px;
  }

  .wbm-dedupe-body .wbm-books-panel,
  .wbm-dedupe-rule-panel {
    grid-column: auto;
    grid-row: auto;
  }

  .wbm-dedupe-body .wbm-books-panel {
    order: 2;
  }

  .wbm-dedupe-rule-panel {
    order: 1;
  }

  .wbm-dedupe-actions > .wbm-primary-btn {
    grid-column: span 3;
  }

  .wbm-dedupe-group-head,
  .wbm-dedupe-keep-row,
  .wbm-dedupe-candidate > div {
    align-items: stretch;
    flex-direction: column;
  }

  .wbm-dedupe-keep-row label {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .wbm-dedupe-candidates {
    grid-template-columns: 1fr;
  }

  .wbm-blue-token-stats {
    grid-column: 1 / -1;
    width: 100%;
    font-size: 12px;
  }

  .wbm-table-wrap {
    display: none;
  }

  .wbm-dialog,
  .wbm-preview,
  .wbm-card-list,
  .wbm-preview-card,
  .wbm-card-head,
  .wbm-entry-title,
  .wbm-mobile-action,
  .wbm-action-stack {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  .wbm-dialog,
  .wbm-preview,
  .wbm-card-list,
  .wbm-preview-card {
    overflow-x: hidden;
  }

  .wbm-card-list {
    display: grid;
    gap: 8px;
    padding-right: 0;
  }

  .wbm-preview-card {
    border: 1px solid var(--wbm-border);
    border-radius: var(--wbm-radius-lg);
    padding: 10px;
    background: var(--wbm-surface);
    display: grid;
    gap: 8px;
  }

  .wbm-card-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }

  .wbm-card-head > * {
    min-width: 0;
  }

  .wbm-preview-card p,
  .wbm-preview-card small {
    display: block;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .wbm-card-meta-grid {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 8px;
    align-items: center;
    font-size: 13px;
  }

  .wbm-card-meta-grid > span:nth-child(odd) {
    opacity: 0.68;
  }

  .wbm-card-meta-grid > span {
    min-width: 0;
  }

  .wbm-card-meta-grid .wbm-state-pill {
    min-width: 0;
    max-width: 100%;
  }

  .wbm-mobile-action .wbm-select {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    height: 42px;
  }

  .wbm-action-display {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .wbm-action-detail {
    grid-column: 2;
  }

  .wbm-risk-list-compact {
    margin-bottom: 0;
  }

  .wbm-content-preview {
    max-height: 160px;
  }

  .wbm-content-editor {
    margin: 0;
  }

  .wbm-textarea {
    min-height: 220px;
    max-height: 55vh;
  }

  .wbm-confirm {
    padding: 10px;
  }

  .wbm-rule-help-modal,
  .wbm-optimizer-settings-modal {
    align-items: stretch;
    justify-content: center;
    padding: 0;
  }

  .wbm-rule-help-modal .wbm-rule-help-box,
  .wbm-optimizer-settings-modal .wbm-optimizer-settings-box {
    width: 100%;
    height: 100%;
    max-height: none;
    margin: 0;
    border: 0;
    border-radius: 0;
    padding: 12px;
    padding-top: calc(12px + env(safe-area-inset-top));
    padding-right: calc(12px + env(safe-area-inset-right));
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
    padding-left: calc(12px + env(safe-area-inset-left));
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .wbm-custom-editor-box {
    width: 100%;
  }

  .wbm-custom-editor-head,
  .wbm-custom-summary,
  .wbm-custom-grid {
    padding: 12px;
  }

  .wbm-custom-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .wbm-custom-summary .wbm-state-pill {
    max-width: 100%;
  }

  .wbm-custom-grid {
    grid-template-columns: 1fr;
  }

  .wbm-custom-field-wide {
    grid-column: auto;
  }

  .wbm-structure-modal {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
  }

  .wbm-structure-box {
    width: 100dvw;
    max-height: none;
    height: var(--wbm-vvh, 100dvh);
    border: 0;
    border-radius: 0;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }

  .wbm-structure-diagram {
    --structure-title-space: 32px;
    min-width: 0;
    min-height: min(480px, calc(var(--wbm-vvh, 100dvh) - 116px));
    padding: 10px;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr) clamp(64px, 18vw, 110px) minmax(0, 1fr);
    overflow: visible;
  }

  .wbm-cylinder {
    min-height: 260px;
    padding: 0 6px;
  }

  .wbm-cylinder-layer {
    left: 6px;
    right: 6px;
    padding: 5px 6px;
    font-size: 11px;
  }

  .wbm-structure-svg,
  .wbm-structure-labels {
    inset: var(--structure-title-space) 10px 10px;
    width: calc(100% - 20px);
    height: calc(100% - var(--structure-title-space) - 10px);
  }

  .wbm-structure-count {
    min-width: 34px;
    min-height: 20px;
    padding: 2px 6px;
    font-size: 11px;
  }
}
</style>
