type TutorialPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';
type TutorialAction = 'prev' | 'next' | 'dismiss';

type TutorialStep = {
  selector?: string | readonly string[];
  title: string;
  content: string;
  placement?: TutorialPlacement;
};

type TutorialState = {
  version: 1;
  revision: number;
  disabled: boolean;
  completed: boolean;
};

type TutorialOptions = {
  manual?: boolean;
  interrupt?: boolean;
};

type TutorialRootSource = ParentNode | (() => ParentNode | null | undefined);

type WorldbookTutorialOptions = {
  root?: TutorialRootSource;
};

export type WorldbookTutorial = {
  maybeStart(options?: { interrupt?: boolean }): void;
  start(options?: TutorialOptions): void;
  close(): void;
};

type ActiveTutorial = {
  steps: TutorialStep[];
  index: number;
  manual: boolean;
  targetCache: Map<number, HTMLElement | null>;
};

type TutorialRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const WORLDBOOK_STORAGE_KEY = 'wbm_tutorial_state_v1';
const CACHE_INSPECTOR_STORAGE_KEY = 'wbm_cache_inspector_tutorial_state_v1';
const DEDUPE_STORAGE_KEY = 'wbm_dedupe_tutorial_state_v1';
const STYLE_ID = 'wbm-tutorial-style';
const OVERLAY_CLASS = 'wbm-tutorial-overlay';
const STATE_REVISION = 1;
const TUTORIAL_Z_INDEX = 30020;
const DEFAULT_STATE: TutorialState = {
  version: 1,
  revision: STATE_REVISION,
  disabled: false,
  completed: false,
};

const WORLDBOOK_STEPS: TutorialStep[] = [
  {
    selector: '.wbm-dialog',
    title: '世界书缓存优化器',
    content:
      '这个工具会读取选中的世界书，按 DeepSeek V4 缓存友好的规则来修改世界书。在真正修改世界书之前，你可以逐条检查脚本建议的改动。',
    placement: 'center',
  },
  {
    selector: '[data-wbm-tutorial="version-manager"]',
    title: '版本管理',
    content:
      '标题旁边的旋转箭头会在后台检查脚本版本。有新版本时按钮会发亮；点击后可以更新到最新版，也可以选择旧版本回退、锁定或切换分发源。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-tutorial="optimizer-settings"]',
    title: '优化设置',
    content:
      '齿轮按钮用于调整优化器的默认行为，包括缓存优化是否处理禁用条目，以及每次打开时默认选择哪类世界书。',
    placement: 'bottom',
  },
  {
    selector: '.wbm-books-panel',
    title: '选择世界书',
    content: '先在这里选择要优化的世界书。自动选择会按照优化设置，选中全局、角色、聊天等指定类别的世界书。',
    placement: 'right',
  },
  {
    selector: '.wbm-rules-panel',
    title: '切换优化规则',
    content:
      '这里可以切换“优化缓存”和“优化提示词构建速度”。下方会展示当前模式会怎么处理世界书；点右上角的说明按钮可以查看每条规则的详细说明。',
    placement: 'left',
  },
  {
    selector: '.wbm-preview-actions',
    title: '生成方案',
    content: '点击后，脚本会先生成并展示修改建议，不会立刻修改世界书。下拉菜单可以切换过滤器和排序。',
    placement: 'bottom',
  },
  {
    selector: ['.wbm-table-wrap', '.wbm-card-list'],
    title: '检查修改意见',
    content: '修改意见区会显示建议修改条目在修改前、修改后的插入位置、插入顺序，以及检测到的变量、宏等动态内容。点击三角符号可展开条目的具体内容，点击铅笔图标可以编辑条目正文。',
    placement: 'top',
  },
  {
    selector: ['.wbm-action-cell', '.wbm-mobile-action'],
    title: '调整修改后',
    content:
      '“修改后”下拉可以改成禁用、保持原样或自定义。自定义弹窗只覆盖灯色、位置、order、概率等会被本工具写入的字段。',
    placement: 'left',
  },
  {
    selector: '[data-wbm-tutorial="structure"]',
    title: '结构图',
    content: '结构图按提示词位置来可视化修改前后的条目插入位置。悬浮或单击修改前的特定插入位置以进行高亮显示。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-tutorial="apply"]',
    title: '应用修改',
    content: '确认修改意见后再应用修改。脚本不提供备份功能，请自行备份修改前的世界书。',
    placement: 'bottom',
  },
];

const CACHE_INSPECTOR_STEPS: TutorialStep[] = [
  {
    selector: '.wbm-dialog.cache-mode',
    title: '缓存命中对比器',
    content:
      '这里会记录每次生成请求返回的缓存命中数据，帮助你看命中率、估算花费，并对比两次请求的提示词断点。',
    placement: 'center',
  },
  {
    selector: '[data-wbm-cache-tutorial="overview"]',
    title: '统计概览',
    content:
      '顶部统计会跟随当前筛选条件变化而变化。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-cache-tutorial="filters"]',
    title: '筛选记录',
    content: '可以按模型、缓存率和是否保有完整提示词来筛选。脚本默认只保留最近80条的完整提示词以供对比。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-cache-tutorial="records"]',
    title: '请求记录',
    content:
      '每条记录显示命中率、模型、提示词长度、token 和估算费用。最近80条提示词会保留完整记录以对比断点；过老的提示词记录只保留统计数据。',
    placement: 'right',
  },
  {
    selector: '[data-wbm-cache-tutorial="usage-chart"]',
    title: '统计图',
    content: '这里会按当前筛选条件展示最近31天的花费、缓存节省、请求次数、token 和模型汇总。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-cache-tutorial="record-actions"]',
    title: '选择旧/新请求',
    content: '点击“旧”和“新”选择两次请求。选择后右侧会定位第一处可能破坏缓存的提示词差异。',
    placement: 'left',
  },
  {
    selector: '[data-wbm-cache-tutorial="diff"]',
    title: '断点对比',
    content:
      '对比器默认只找第一处差异。未展开全文时，“跳到断点”会跳到摘要高亮；展开全文后会跳到全文高亮。',
    placement: 'left',
  },
  {
    selector: '[data-wbm-cache-tutorial="diff-actions"]',
    title: '全文与断点',
    content: '如果差异上下文不够，可以展开全文。',
    placement: 'bottom',
  },
];

const DEDUPE_STEPS: TutorialStep[] = [
  {
    selector: '.wbm-dialog',
    title: '世界书智能去重',
    content: '这里会先生成去重建议，不会直接删除世界书。确认应用前，你可以逐组检查并取消勾选。',
    placement: 'center',
  },
  {
    selector: '[data-wbm-tutorial="dedupe-books"]',
    title: '选择世界书',
    content: '先选择要参与查重的世界书。搜索、来源和排序只影响列表显示，不会自动删除任何内容。',
    placement: 'right',
  },
  {
    selector: '[data-wbm-tutorial="dedupe-selection"]',
    title: '批量选择',
    content: '自动选择会按当前绑定挑出常用世界书。全选只选择当前列表里看得见的结果，清空会取消所有选择。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-tutorial="dedupe-rules"]',
    title: '选择策略',
    content: '保守误报少，平衡适合默认使用，激进会找出更多可疑重复，也更需要你检查。',
    placement: 'left',
  },
  {
    selector: '[data-wbm-tutorial="dedupe-generate"]',
    title: '生成方案',
    content: '点击后只会生成候选方案。方案出来前，不会重绑角色卡，也不会删除世界书。',
    placement: 'bottom',
  },
  {
    selector: '[data-wbm-tutorial="dedupe-groups"]',
    title: '检查候选',
    content: '这里会显示置信度、相似度、绑定来源和警告。低置信度或跨名称候选，应用前要多看一眼。',
    placement: 'top',
  },
  {
    selector: '[data-wbm-tutorial="dedupe-apply"]',
    title: '确认应用',
    content: '确认后才会先重绑引用，再删除旧世界书。仍然不确定的候选，可以先取消勾选。',
    placement: 'bottom',
  },
];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeState = (raw: unknown): TutorialState => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const data = raw as Partial<TutorialState>;
  if (typeof data.revision !== 'number' || data.revision < STATE_REVISION) return { ...DEFAULT_STATE };
  return {
    version: 1,
    revision: STATE_REVISION,
    disabled: data.disabled === true,
    completed: data.completed === true,
  };
};

const getSelectors = (step: TutorialStep): readonly string[] => {
  if (!step.selector) return [];
  return Array.isArray(step.selector) ? step.selector : [step.selector];
};

const isTutorialAction = (action: string | undefined): action is TutorialAction =>
  action === 'prev' || action === 'next' || action === 'dismiss';

export function createWorldbookTutorial(options: WorldbookTutorialOptions = {}): WorldbookTutorial {
  return createTutorial(options, WORLDBOOK_STEPS, WORLDBOOK_STORAGE_KEY, '世界书缓存优化器');
}

export function createCacheInspectorTutorial(options: WorldbookTutorialOptions = {}): WorldbookTutorial {
  return createTutorial(options, CACHE_INSPECTOR_STEPS, CACHE_INSPECTOR_STORAGE_KEY, '缓存命中对比');
}

export function createDedupeTutorial(options: WorldbookTutorialOptions = {}): WorldbookTutorial {
  return createTutorial(options, DEDUPE_STEPS, DEDUPE_STORAGE_KEY, '世界书智能去重');
}

function createTutorial(
  options: WorldbookTutorialOptions,
  configuredSteps: TutorialStep[],
  storageKey: string,
  logName: string,
): WorldbookTutorial {
  let activeTutorial: ActiveTutorial | null = null;
  let overlay: HTMLElement | null = null;
  let blocker: HTMLElement | null = null;
  let highlight: HTMLElement | null = null;
  let popover: HTMLElement | null = null;
  let maskSvg: SVGSVGElement | null = null;
  let maskPath: SVGPathElement | null = null;
  let repositionRaf: number | null = null;
  let scrollRaf: number | null = null;
  let lastActionAt = 0;

  const getConfiguredRoot = (): ParentNode | null | undefined => {
    return typeof options.root === 'function' ? options.root() : options.root;
  };

  const getDoc = (): Document => {
    const root = getConfiguredRoot();
    if (root instanceof Document) return root;
    if (root instanceof Element) return root.ownerDocument;
    return document;
  };

  const getWin = (): Window => getDoc().defaultView || window;

  const getState = (): TutorialState => {
    try {
      return normalizeState(JSON.parse(getWin().localStorage.getItem(storageKey) || 'null'));
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  const saveState = (state: TutorialState): void => {
    try {
      getWin().localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage can be blocked in embedded/private contexts; tutorial state is optional.
    }
  };

  const getQueryRoots = (): ParentNode[] => {
    const roots: ParentNode[] = [];
    const addRoot = (root: ParentNode | null | undefined): void => {
      if (root && !roots.includes(root)) roots.push(root);
    };
    addRoot(getConfiguredRoot());
    addRoot(getDoc());
    return roots;
  };

  const injectStyles = (): void => {
    const doc = getDoc();
    const existingStyle = doc.getElementById(STYLE_ID);
    const style =
      existingStyle?.tagName.toLowerCase() === 'style' ? (existingStyle as HTMLStyleElement) : doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: fixed;
        inset: 0;
        z-index: ${TUTORIAL_Z_INDEX};
        pointer-events: auto;
        isolation: isolate;
        color: #f4f4f5;
        font-family: "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .wbm-tutorial-blocker {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 0;
        background: rgba(0, 0, 0, 0.001);
        pointer-events: auto;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }
      .wbm-tutorial-mask {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 1;
        pointer-events: none;
        contain: layout paint style;
      }
      .wbm-tutorial-mask path {
        fill: rgba(0, 0, 0, 0.66);
      }
      .wbm-tutorial-highlight {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2;
        border: 2px solid #4d6bfe;
        border-radius: 14px;
        box-shadow: 0 0 0 6px rgba(77, 107, 254, 0.24);
        pointer-events: none;
        opacity: 0;
        transition: transform 0.18s ease, width 0.18s ease, height 0.18s ease, opacity 0.12s ease;
        will-change: transform, width, height;
        contain: layout paint style;
      }
      .wbm-tutorial-popover {
        position: fixed;
        z-index: 3;
        width: min(360px, calc(100vw - 24px));
        border: 1px solid #3a3b40;
        border-radius: 14px;
        background: #1d1d20;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.54);
        overflow: hidden;
      }
      .wbm-tutorial-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 13px 15px;
        border-bottom: 1px solid #303137;
        background: #23252b;
        font-size: 14px;
        font-weight: 800;
      }
      .wbm-tutorial-head i {
        color: #4d6bfe;
      }
      .wbm-tutorial-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        margin: -5px -7px -5px auto;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: #c8cbd5;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .wbm-tutorial-close:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }
      .wbm-tutorial-body {
        padding: 14px 15px 12px;
        color: #d9dbe3;
        font-size: 13px;
        line-height: 1.65;
      }
      .wbm-tutorial-progress {
        margin-top: 10px;
        color: #9ca3af;
        font-size: 11px;
      }
      .wbm-tutorial-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        padding: 11px 12px;
        border-top: 1px solid #303137;
        background: #17181b;
      }
      .wbm-tutorial-btn {
        width: 100%;
        min-width: 0;
        min-height: 32px;
        padding: 6px 10px;
        border: 1px solid #3a3b40;
        border-radius: 10px;
        background: #2a2b2f;
        color: #f4f4f5;
        cursor: pointer;
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }
      .wbm-tutorial-btn:hover:not(:disabled) {
        border-color: #4d6bfe;
        background: rgba(77, 107, 254, 0.18);
      }
      .wbm-tutorial-btn.primary {
        border-color: #4d6bfe;
        background: #4d6bfe;
        color: #fff;
        font-weight: 800;
      }
      .wbm-tutorial-btn:disabled {
        opacity: 0.42;
        cursor: not-allowed;
      }
      @media (max-width: 640px) {
        .wbm-tutorial-popover {
          width: calc(100vw - 20px);
          max-height: var(--wbm-tutorial-mobile-max-height, min(380px, 42dvh));
          display: flex;
          flex-direction: column;
          border-radius: 12px;
        }
        .wbm-tutorial-highlight {
          box-shadow: 0 0 0 4px rgba(77, 107, 254, 0.24);
        }
        .wbm-tutorial-body {
          overflow-y: auto;
        }
        .wbm-tutorial-btn {
          min-height: 40px;
        }
      }
    `;
    if (!existingStyle) doc.head.appendChild(style);
  };

  const isVisibleElement = (element: HTMLElement): boolean => {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getWin().getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const queryVisibleElement = (selector: string): HTMLElement | null => {
    for (const root of getQueryRoots()) {
      const candidates = root.querySelectorAll<HTMLElement>(selector);
      for (const element of candidates) {
        if (isVisibleElement(element)) return element;
      }
    }
    return null;
  };

  const findTarget = (tutorial: ActiveTutorial, index: number): HTMLElement | null => {
    const cached = tutorial.targetCache.get(index);
    if (cached && isVisibleElement(cached)) return cached;
    if (tutorial.targetCache.has(index)) tutorial.targetCache.delete(index);

    for (const selector of getSelectors(tutorial.steps[index])) {
      const target = queryVisibleElement(selector);
      if (target) {
        tutorial.targetCache.set(index, target);
        return target;
      }
    }
    tutorial.targetCache.set(index, null);
    return null;
  };

  const getViewportRect = (): TutorialRect => {
    const win = getWin();
    const visual = win.visualViewport;
    const left = visual?.offsetLeft ?? 0;
    const top = visual?.offsetTop ?? 0;
    const width = visual?.width ?? win.innerWidth;
    const height = visual?.height ?? win.innerHeight;
    return { left, top, width, height, right: left + width, bottom: top + height };
  };

  const getElementRect = (element: HTMLElement | null): TutorialRect => {
    const viewport = getViewportRect();
    if (!element) {
      return {
        left: viewport.left + viewport.width / 2 - 1,
        top: viewport.top + viewport.height / 2 - 1,
        right: viewport.left + viewport.width / 2 + 1,
        bottom: viewport.top + viewport.height / 2 + 1,
        width: 2,
        height: 2,
      };
    }
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  const positionFor = (target: TutorialRect, popoverRect: DOMRect, placement: TutorialPlacement): { left: number; top: number } => {
    const viewport = getViewportRect();
    const gap = 12;
    const margin = 12;
    const centerLeft = target.left + target.width / 2 - popoverRect.width / 2;
    const centerTop = target.top + target.height / 2 - popoverRect.height / 2;
    let left = centerLeft;
    let top = target.bottom + gap;

    if (placement === 'top') top = target.top - popoverRect.height - gap;
    if (placement === 'left') {
      left = target.left - popoverRect.width - gap;
      top = centerTop;
    }
    if (placement === 'right') {
      left = target.right + gap;
      top = centerTop;
    }
    if (placement === 'center') {
      left = viewport.left + viewport.width / 2 - popoverRect.width / 2;
      top = viewport.top + viewport.height / 2 - popoverRect.height / 2;
    }

    if (placement !== 'center') {
      const hasRoomTop = target.top - viewport.top >= popoverRect.height + gap + margin;
      const hasRoomBottom = viewport.bottom - target.bottom >= popoverRect.height + gap + margin;
      if (top < viewport.top + margin && hasRoomBottom) top = target.bottom + gap;
      if (top + popoverRect.height > viewport.bottom - margin && hasRoomTop) top = target.top - popoverRect.height - gap;
    }

    return {
      left: clamp(left, viewport.left + margin, viewport.right - popoverRect.width - margin),
      top: clamp(top, viewport.top + margin, viewport.bottom - popoverRect.height - margin),
    };
  };

  const isMobileTutorialViewport = (): boolean => {
    const viewport = getViewportRect();
    const win = getWin();
    const coarsePointer = win.matchMedia?.('(pointer: coarse)').matches === true;
    return viewport.width <= 640 || (coarsePointer && viewport.width <= 820);
  };

  const getMobilePopoverPosition = (target: TutorialRect, popoverRect: DOMRect): { left: number; top: number } => {
    const viewport = getViewportRect();
    const gap = 12;
    const margin = 10;
    const minLeft = viewport.left + margin;
    const minTop = viewport.top + margin;
    const maxLeft = Math.max(minLeft, viewport.right - popoverRect.width - margin);
    const maxTop = Math.max(minTop, viewport.bottom - popoverRect.height - margin);
    const left = clamp(viewport.left + (viewport.width - popoverRect.width) / 2, minLeft, maxLeft);

    const targetCenterY = target.top + target.height / 2;
    const targetInUpperHalf = targetCenterY < viewport.top + viewport.height / 2;
    const preferredTop = targetInUpperHalf ? maxTop : minTop;
    const fallbackTop = targetInUpperHalf ? minTop : maxTop;
    const hasVerticalGap = (top: number): boolean =>
      top + popoverRect.height <= target.top - gap || top >= target.bottom + gap;

    if (hasVerticalGap(preferredTop)) return { left, top: preferredTop };
    if (hasVerticalGap(fallbackTop)) return { left, top: fallbackTop };

    const spaceAbove = Math.max(0, target.top - viewport.top);
    const spaceBelow = Math.max(0, viewport.bottom - target.bottom);
    const top = spaceBelow >= spaceAbove ? target.bottom + gap : target.top - popoverRect.height - gap;
    return { left, top: clamp(top, minTop, maxTop) };
  };

  const getTargetSafeRect = (popoverRect?: TutorialRect | null): TutorialRect => {
    const viewport = getViewportRect();
    const margin = 10;
    const gap = 12;
    let top = viewport.top + margin;
    let bottom = viewport.bottom - margin;

    if (popoverRect && popoverRect.bottom > viewport.top && popoverRect.top < viewport.bottom) {
      const popoverCenterY = popoverRect.top + popoverRect.height / 2;
      if (popoverCenterY < viewport.top + viewport.height / 2) {
        top = Math.max(top, popoverRect.bottom + gap);
      } else {
        bottom = Math.min(bottom, popoverRect.top - gap);
      }
    }

    if (bottom - top < 120) {
      top = viewport.top + margin;
      bottom = viewport.bottom - margin;
    }

    return {
      left: viewport.left + margin,
      top,
      right: viewport.right - margin,
      bottom,
      width: Math.max(0, viewport.width - margin * 2),
      height: Math.max(0, bottom - top),
    };
  };

  const getCurrentPopoverRect = (): TutorialRect | null => {
    if (!popover || popover.style.visibility === 'hidden') return null;
    const rect = popover.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  const requestReposition = (): void => {
    const win = getWin();
    if (repositionRaf !== null) win.cancelAnimationFrame(repositionRaf);
    repositionRaf = win.requestAnimationFrame(() => {
      repositionRaf = null;
      positionElements();
    });
  };

  const getScrollParent = (element: HTMLElement): HTMLElement | null => {
    const doc = getDoc();
    let current = element.parentElement;
    while (current && current !== doc.body) {
      const style = getWin().getComputedStyle(current);
      const canScroll = /(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1;
      if (canScroll) return current;
      current = current.parentElement;
    }
    return (doc.scrollingElement as HTMLElement | null) || doc.documentElement;
  };

  const scrollElementBy = (element: HTMLElement, deltaY: number): boolean => {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const nextScrollTop = clamp(element.scrollTop + deltaY, 0, maxScrollTop);
    if (Math.abs(nextScrollTop - element.scrollTop) < 1) return false;
    element.scrollTop = nextScrollTop;
    return true;
  };

  const scrollTargetIntoSafeRect = (target: HTMLElement, avoidPopover: boolean): boolean => {
    const safeRect = getTargetSafeRect(avoidPopover ? getCurrentPopoverRect() : null);
    const rect = target.getBoundingClientRect();
    let deltaY = 0;

    if (rect.height > safeRect.height) {
      if (rect.top > safeRect.top) {
        deltaY = rect.top - safeRect.top;
      } else if (rect.bottom < safeRect.bottom) {
        deltaY = rect.bottom - safeRect.bottom;
      }
    } else if (rect.top < safeRect.top) {
      deltaY = rect.top - safeRect.top;
    } else if (rect.bottom > safeRect.bottom) {
      deltaY = rect.bottom - safeRect.bottom;
    }

    if (Math.abs(deltaY) < 1) return false;
    const scrollParent = getScrollParent(target);
    if (scrollParent && scrollElementBy(scrollParent, deltaY)) return true;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  };

  const isTargetInsideSafeRect = (target: HTMLElement, avoidPopover: boolean): boolean => {
    const safeRect = getTargetSafeRect(avoidPopover ? getCurrentPopoverRect() : null);
    const rect = target.getBoundingClientRect();
    const horizontalMargin = 4;
    const hasHorizontalPresence = rect.right >= safeRect.left + horizontalMargin && rect.left <= safeRect.right - horizontalMargin;
    const hasVerticalPresence =
      rect.height > safeRect.height
        ? rect.bottom >= safeRect.top && rect.top <= safeRect.bottom
        : rect.top >= safeRect.top && rect.bottom <= safeRect.bottom;
    return hasHorizontalPresence && hasVerticalPresence;
  };

  const scheduleTargetIntoView = (): void => {
    if (!activeTutorial) return;
    const win = getWin();
    if (scrollRaf !== null) {
      win.cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }

    const tutorial = activeTutorial;
    const index = tutorial.index;
    const target = findTarget(tutorial, index);
    if (!target) {
      requestReposition();
      return;
    }

    const mobile = isMobileTutorialViewport();
    if (isTargetInsideSafeRect(target, mobile)) {
      requestReposition();
      return;
    }

    scrollTargetIntoSafeRect(target, mobile);
    scrollRaf = win.requestAnimationFrame(() => {
      scrollRaf = win.requestAnimationFrame(() => {
        scrollRaf = null;
        if (activeTutorial === tutorial && activeTutorial.index === index) requestReposition();
      });
    });
  };

  function positionElements(): void {
    if (!activeTutorial || !highlight || !popover) return;
    const step = activeTutorial.steps[activeTutorial.index];
    const target = findTarget(activeTutorial, activeTutorial.index);
    const viewport = getViewportRect();
    const mobile = isMobileTutorialViewport();
    if (mobile) {
      const mobileMaxHeight = Math.max(160, Math.min(360, viewport.height * 0.42));
      popover.style.setProperty('--wbm-tutorial-mobile-max-height', `${Math.round(mobileMaxHeight)}px`);
    } else {
      popover.style.removeProperty('--wbm-tutorial-mobile-max-height');
    }

    const rect = getElementRect(target);
    const padding = target ? 6 : 0;
    const popoverRect = popover.getBoundingClientRect();
    const pos =
      mobile && target
        ? getMobilePopoverPosition(rect, popoverRect)
        : positionFor(rect, popoverRect, step.placement || 'bottom');
    const futurePopoverRect: TutorialRect = {
      left: pos.left,
      top: pos.top,
      right: pos.left + popoverRect.width,
      bottom: pos.top + popoverRect.height,
      width: popoverRect.width,
      height: popoverRect.height,
    };
    const safeRect = getTargetSafeRect(mobile && target ? futurePopoverRect : null);
    const left = clamp(rect.left - padding, safeRect.left, safeRect.right);
    const top = clamp(rect.top - padding, safeRect.top, safeRect.bottom);
    const right = clamp(rect.right + padding, safeRect.left, safeRect.right);
    const bottom = clamp(rect.bottom + padding, safeRect.top, safeRect.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    highlight.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    highlight.style.width = `${Math.round(width)}px`;
    highlight.style.height = `${Math.round(height)}px`;
    highlight.style.opacity = target && width > 1 && height > 1 ? '1' : '0';
    positionMask({ left, top, width, height, visible: Boolean(target && width > 1 && height > 1), viewport });

    popover.style.left = `${Math.round(pos.left)}px`;
    popover.style.top = `${Math.round(pos.top)}px`;
    popover.style.visibility = 'visible';
  }

  const positionMask = (rect: {
    left: number;
    top: number;
    width: number;
    height: number;
    visible: boolean;
    viewport: TutorialRect;
  }): void => {
    if (!maskSvg || !maskPath) return;
    const viewportWidth = Math.max(0, Math.round(rect.viewport.width));
    const viewportHeight = Math.max(0, Math.round(rect.viewport.height));
    maskSvg.setAttribute('viewBox', `0 0 ${viewportWidth} ${viewportHeight}`);
    maskSvg.setAttribute('width', `${viewportWidth}`);
    maskSvg.setAttribute('height', `${viewportHeight}`);

    const outerPath = `M0 0H${viewportWidth}V${viewportHeight}H0Z`;
    if (!rect.visible) {
      maskPath.setAttribute('d', outerPath);
      return;
    }

    const relativeLeft = rect.left - rect.viewport.left;
    const relativeTop = rect.top - rect.viewport.top;
    const left = Math.round(clamp(relativeLeft, 0, viewportWidth));
    const top = Math.round(clamp(relativeTop, 0, viewportHeight));
    const right = Math.round(clamp(relativeLeft + rect.width, 0, viewportWidth));
    const bottom = Math.round(clamp(relativeTop + rect.height, 0, viewportHeight));
    maskPath.setAttribute('d', `${outerPath}M${left} ${top}H${right}V${bottom}H${left}Z`);
  };

  const collectVisibleSteps = (): TutorialStep[] => {
    const steps: TutorialStep[] = [];
    for (const step of configuredSteps) {
      if (!step.selector || getSelectors(step).some(selector => queryVisibleElement(selector))) steps.push(step);
    }
    return steps;
  };

  const closeInternal = (complete: boolean): void => {
    if (complete) saveState({ ...getState(), completed: true });
    removeListeners();
    if (repositionRaf !== null) {
      getWin().cancelAnimationFrame(repositionRaf);
      repositionRaf = null;
    }
    if (scrollRaf !== null) {
      getWin().cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
    overlay?.remove();
    overlay = null;
    blocker = null;
    highlight = null;
    popover = null;
    maskSvg = null;
    maskPath = null;
    activeTutorial = null;
  };

  const goTo = (direction: 1 | -1): void => {
    if (!activeTutorial) return;
    const nextIndex = activeTutorial.index + direction;
    if (nextIndex < 0) return;
    if (nextIndex >= activeTutorial.steps.length) {
      closeInternal(true);
      return;
    }
    activeTutorial.index = nextIndex;
    activeTutorial.targetCache.clear();
    render();
  };

  const runAction = (action: TutorialAction): void => {
    if (action === 'prev') goTo(-1);
    if (action === 'next') goTo(1);
    if (action === 'dismiss') {
      saveState({ ...getState(), completed: true, disabled: true });
      closeInternal(false);
    }
  };

  const isPopoverEventTarget = (target: EventTarget | null): boolean => {
    if (!target || !popover) return false;
    return target instanceof getWin().Node && popover.contains(target);
  };

  const blockOutsideTutorialEvent = (event: Event): void => {
    if (!activeTutorial || !overlay || isPopoverEventTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const blockedEventNames = [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'touchstart',
    'touchmove',
    'touchend',
    'wheel',
    'contextmenu',
  ] as const;

  const addListeners = (): void => {
    const win = getWin();
    const doc = getDoc();
    win.addEventListener('resize', requestReposition, { passive: true });
    win.addEventListener('scroll', requestReposition, { passive: true });
    win.visualViewport?.addEventListener('resize', requestReposition, { passive: true });
    win.visualViewport?.addEventListener('scroll', requestReposition, { passive: true });
    blockedEventNames.forEach(eventName => {
      doc.addEventListener(eventName, blockOutsideTutorialEvent, { capture: true, passive: false });
    });
  };

  const removeListeners = (): void => {
    const win = getWin();
    const doc = getDoc();
    win.removeEventListener('resize', requestReposition);
    win.removeEventListener('scroll', requestReposition);
    win.visualViewport?.removeEventListener('resize', requestReposition);
    win.visualViewport?.removeEventListener('scroll', requestReposition);
    blockedEventNames.forEach(eventName => {
      doc.removeEventListener(eventName, blockOutsideTutorialEvent, true);
    });
  };

  const handleClick = (event: Event): void => {
    const win = getWin();
    const element =
      event.target instanceof win.Element ? event.target.closest<HTMLElement>('[data-wbm-tutorial-action]') : null;
    if (!element) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (element instanceof win.HTMLButtonElement && element.disabled) return;
    const action = element.dataset.wbmTutorialAction;
    if (!isTutorialAction(action)) return;

    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - lastActionAt < 220) return;
    lastActionAt = now;
    runAction(action);
  };

  const createOverlay = (): void => {
    const doc = getDoc();
    const svgNamespace = 'http://www.w3.org/2000/svg';
    overlay = doc.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.style.zIndex = String(TUTORIAL_Z_INDEX);
    blocker = doc.createElement('div');
    blocker.className = 'wbm-tutorial-blocker';
    maskSvg = doc.createElementNS(svgNamespace, 'svg');
    maskSvg.classList.add('wbm-tutorial-mask');
    maskSvg.setAttribute('aria-hidden', 'true');
    maskPath = doc.createElementNS(svgNamespace, 'path');
    maskPath.setAttribute('fill-rule', 'evenodd');
    maskSvg.appendChild(maskPath);
    highlight = doc.createElement('div');
    highlight.className = 'wbm-tutorial-highlight';
    popover = doc.createElement('div');
    popover.className = 'wbm-tutorial-popover';
    popover.style.visibility = 'hidden';
    overlay.append(blocker, maskSvg, highlight, popover);
    overlay.addEventListener('click', handleClick);
    overlay.addEventListener('touchend', handleClick, { passive: false });
    doc.body.appendChild(overlay);
  };

  function render(): void {
    if (!activeTutorial || !popover) return;
    const step = activeTutorial.steps[activeTutorial.index];
    const isFirst = activeTutorial.index === 0;
    const isLast = activeTutorial.index === activeTutorial.steps.length - 1;
    popover.innerHTML = `
      <div class="wbm-tutorial-head">
        <i class="fa-solid fa-circle-question"></i>
        <span>${escapeHtml(step.title)}</span>
        <button
          class="wbm-tutorial-close"
          type="button"
          title="关闭教程"
          aria-label="关闭教程"
          data-wbm-tutorial-action="dismiss"
        >×</button>
      </div>
      <div class="wbm-tutorial-body">
        <div>${escapeHtml(step.content)}</div>
        <div class="wbm-tutorial-progress">${activeTutorial.index + 1} / ${activeTutorial.steps.length}</div>
      </div>
      <div class="wbm-tutorial-actions">
        <button class="wbm-tutorial-btn" data-wbm-tutorial-action="prev" ${isFirst ? 'disabled' : ''}>上一步</button>
        <button class="wbm-tutorial-btn primary" data-wbm-tutorial-action="next">${isLast ? '完成' : '下一步'}</button>
      </div>
    `;
    scheduleTargetIntoView();
  }

  const start = (options: TutorialOptions = {}): void => {
    const manual = options.manual === true;
    if (activeTutorial && !manual && options.interrupt !== true) return;
    const state = getState();
    if (!manual && (state.disabled || state.completed)) return;
    const steps = collectVisibleSteps();
    if (steps.length === 0) {
      console.warn(`[${logName}] 没有找到可播放的教程步骤。`);
      return;
    }

    closeInternal(false);
    injectStyles();
    activeTutorial = { steps, index: 0, manual, targetCache: new Map() };
    createOverlay();
    addListeners();
    render();
  };

  const maybeStart = (options: { interrupt?: boolean } = {}): void => {
    const state = getState();
    if (state.disabled || state.completed) return;
    getWin().setTimeout(() => start({ interrupt: options.interrupt === true }), 260);
  };

  return {
    maybeStart,
    start,
    close: () => closeInternal(false),
  };
}
