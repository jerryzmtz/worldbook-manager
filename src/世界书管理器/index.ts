import { createScriptIdDiv, teleportStyle } from '@util/script';
import App from './App.vue';
import {
  cleanupCacheInspectorMonitorPatches,
  installCacheInspectorMonitor,
  type CacheInspectorMonitorHandle,
  type CacheInspectorMonitorOptions,
} from './cache-inspector';

const OPEN_MANAGER_BUTTON = '世界书缓存优化器';
const OPEN_CACHE_INSPECTOR_BUTTON = '缓存命中对比';
const LEGACY_OPEN_MANAGER_BUTTONS = ['世界书管理', '打开世界书批量管理器'];
const OPEN_MANAGER_EVENT = 'worldbook-manager:open';
const OPEN_CACHE_INSPECTOR_EVENT = 'worldbook-manager:open-cache-inspector';
const DEFAULT_VISIBLE_MIGRATION_KEY = 'worldbookManagerButtonDefaultVisibleMigrated';
const IOS_CACHE_MONITOR_DISABLE_STORAGE_KEY = 'worldbookCacheInspectorDisableMonitorOnIOS';
const IOS_CACHE_TAURI_FALLBACK_STORAGE_KEY = 'worldbookCacheInspectorTauriFallbackOnIOS';
const RUNTIME_GLOBAL_KEY = '__worldbookManagerRuntime';

type WorldbookManagerRuntime = {
  destroy: () => void;
};

type WorldbookManagerWindow = Window & {
  [RUNTIME_GLOBAL_KEY]?: WorldbookManagerRuntime | null;
};

const app = createApp(App).use(createPinia());
let styleHandle: { destroy: () => void } | null = null;
let $appRoot: JQuery<HTMLDivElement> | null = null;
let buttonEventHandle: EventOnReturn | null = null;
let cacheButtonEventHandle: EventOnReturn | null = null;
let cacheMonitorHandle: CacheInspectorMonitorHandle | null = null;

function scriptButton(name: string, button: Partial<ScriptButton> = {}, forceVisible = false): ScriptButton {
  const nextButton = { ...button, name } as ScriptButton;
  if (forceVisible || typeof nextButton.visible !== 'boolean') {
    nextButton.visible = true;
  }
  return nextButton;
}

function shouldForceButtonVisibleOnce(): boolean {
  try {
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    if (variables[DEFAULT_VISIBLE_MIGRATION_KEY]) {
      return false;
    }

    insertOrAssignVariables({ [DEFAULT_VISIBLE_MIGRATION_KEY]: true }, { type: 'script', script_id: getScriptId() });
    return true;
  } catch (error) {
    console.warn('[世界书缓存优化器] 无法记录脚本按钮默认显示状态', error);
    return false;
  }
}

$(() => {
  destroyPreviousRuntime();
  cleanupCacheInspectorMonitorPatches();
  $appRoot = createScriptIdDiv();
  $appRoot.css('display', 'contents');
  $('body').append($appRoot);
  styleHandle = teleportStyle();
  app.mount($appRoot[0]);

  const cacheMonitorOptions = getCacheInspectorMonitorOptions();
  cacheMonitorHandle = cacheMonitorOptions ? installCacheInspectorMonitor(cacheMonitorOptions) : null;
  syncManagerButton();
  buttonEventHandle = eventOn(getButtonEvent(OPEN_MANAGER_BUTTON), () => {
    console.info('[世界书缓存优化器] 收到脚本按钮事件');
    window.dispatchEvent(new CustomEvent(OPEN_MANAGER_EVENT));
  });
  cacheButtonEventHandle = eventOn(getButtonEvent(OPEN_CACHE_INSPECTOR_BUTTON), () => {
    console.info('[缓存命中对比] 收到脚本按钮事件');
    window.dispatchEvent(new CustomEvent(OPEN_CACHE_INSPECTOR_EVENT));
  });
  (window as WorldbookManagerWindow)[RUNTIME_GLOBAL_KEY] = { destroy: destroyRuntime };
});

function destroyPreviousRuntime(): void {
  const managerWindow = window as WorldbookManagerWindow;
  try {
    managerWindow[RUNTIME_GLOBAL_KEY]?.destroy();
  } catch (error) {
    console.warn('[世界书缓存优化器] 清理旧脚本实例失败', error);
  } finally {
    managerWindow[RUNTIME_GLOBAL_KEY] = null;
  }
}

function shouldDisableCacheInspectorMonitorOnIOS(): boolean {
  if (!isIOSWebViewLikeRuntime()) return false;
  if (!isIOSCacheMonitorDisabled()) return false;
  console.warn(
    `[缓存命中对比] 已通过 localStorage.${IOS_CACHE_MONITOR_DISABLE_STORAGE_KEY} 关闭 iOS 请求捕获。`,
  );
  return true;
}

function getCacheInspectorMonitorOptions(): CacheInspectorMonitorOptions | null {
  if (shouldDisableCacheInspectorMonitorOnIOS()) return null;
  if (!isIOSWebViewLikeRuntime()) return {};
  const captureTauriVisibleResponseFallback = isIOSCacheTauriFallbackEnabled();
  if (!captureTauriVisibleResponseFallback) {
    console.info(
      `[缓存命中对比] iOS WebView 关闭 TauriTavern 可见响应 fallback，以避免读取流式响应体。需要强制启用可设置 localStorage.${IOS_CACHE_TAURI_FALLBACK_STORAGE_KEY} = '1'。`,
    );
  }
  return { captureTauriVisibleResponseFallback };
}

function isIOSWebViewLikeRuntime(): boolean {
  try {
    const userAgent = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

function isIOSCacheMonitorDisabled(): boolean {
  try {
    const value = window.localStorage?.getItem(IOS_CACHE_MONITOR_DISABLE_STORAGE_KEY);
    if (!value) return false;
    return ['1', 'true', 'enabled', 'disabled'].includes(value.toLowerCase());
  } catch {
    return false;
  }
}

function isIOSCacheTauriFallbackEnabled(): boolean {
  try {
    const value = window.localStorage?.getItem(IOS_CACHE_TAURI_FALLBACK_STORAGE_KEY);
    if (!value) return false;
    return ['1', 'true', 'enabled'].includes(value.toLowerCase());
  } catch {
    return false;
  }
}

function syncManagerButton(): void {
  const forceVisibleOnce = shouldForceButtonVisibleOnce();

  updateScriptButtonsWith(buttons => {
    const existingManagerButton = buttons.find(button => button.name === OPEN_MANAGER_BUTTON);
    const existingCacheButton = buttons.find(button => button.name === OPEN_CACHE_INSPECTOR_BUTTON);
    let insertedManagerButton = false;
    let insertedCacheButton = false;
    const nextButtons: ScriptButton[] = [];

    for (const button of buttons) {
      if (LEGACY_OPEN_MANAGER_BUTTONS.includes(button.name)) {
        if (!existingManagerButton && !insertedManagerButton) {
          nextButtons.push(scriptButton(OPEN_MANAGER_BUTTON, button, forceVisibleOnce));
          insertedManagerButton = true;
        }
        continue;
      }

      if (button.name === OPEN_MANAGER_BUTTON) {
        if (!insertedManagerButton) {
          nextButtons.push(scriptButton(OPEN_MANAGER_BUTTON, button, forceVisibleOnce));
          insertedManagerButton = true;
        }
        continue;
      }

      if (button.name === OPEN_CACHE_INSPECTOR_BUTTON) {
        if (!insertedCacheButton) {
          nextButtons.push(scriptButton(OPEN_CACHE_INSPECTOR_BUTTON, button, forceVisibleOnce));
          insertedCacheButton = true;
        }
        continue;
      }

      nextButtons.push(button);
    }

    if (!insertedManagerButton) {
      nextButtons.push(scriptButton(OPEN_MANAGER_BUTTON, {}, true));
    }

    if (!insertedCacheButton) {
      nextButtons.push(scriptButton(OPEN_CACHE_INSPECTOR_BUTTON, existingCacheButton, true));
    }

    return nextButtons;
  });
}

function destroyRuntime(): void {
  buttonEventHandle?.stop();
  cacheButtonEventHandle?.stop();
  cacheMonitorHandle?.destroy();
  app.unmount();
  styleHandle?.destroy();
  $appRoot?.remove();
  buttonEventHandle = null;
  cacheButtonEventHandle = null;
  cacheMonitorHandle = null;
  styleHandle = null;
  $appRoot = null;
  const managerWindow = window as WorldbookManagerWindow;
  if (managerWindow[RUNTIME_GLOBAL_KEY]?.destroy === destroyRuntime) {
    managerWindow[RUNTIME_GLOBAL_KEY] = null;
  }
}

$(window).on('pagehide', destroyRuntime);
