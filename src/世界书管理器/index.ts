import { createScriptIdDiv, teleportStyle } from '@util/script';
import App from './App.vue';

const OPEN_MANAGER_BUTTON = '世界书缓存优化器';
const LEGACY_OPEN_MANAGER_BUTTONS = ['世界书管理', '打开世界书批量管理器'];
const OPEN_MANAGER_EVENT = 'worldbook-manager:open';
const DEFAULT_VISIBLE_MIGRATION_KEY = 'worldbookManagerButtonDefaultVisibleMigrated';

const app = createApp(App).use(createPinia());
let styleHandle: { destroy: () => void } | null = null;
let $appRoot: JQuery<HTMLDivElement> | null = null;
let buttonEventHandle: EventOnReturn | null = null;

function managerButton(button: Partial<ScriptButton> = {}, forceVisible = false): ScriptButton {
  const nextButton = { ...button, name: OPEN_MANAGER_BUTTON } as ScriptButton;
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
  $appRoot = createScriptIdDiv();
  $appRoot.css('display', 'contents');
  $('body').append($appRoot);
  styleHandle = teleportStyle();
  app.mount($appRoot[0]);

  syncManagerButton();
  buttonEventHandle = eventOn(getButtonEvent(OPEN_MANAGER_BUTTON), () => {
    console.info('[世界书缓存优化器] 收到脚本按钮事件');
    window.dispatchEvent(new CustomEvent(OPEN_MANAGER_EVENT));
  });
});

function syncManagerButton(): void {
  const forceVisibleOnce = shouldForceButtonVisibleOnce();

  updateScriptButtonsWith(buttons => {
    const hasCurrentButton = buttons.some(button => button.name === OPEN_MANAGER_BUTTON);
    let insertedCurrentButton = false;
    const nextButtons: ScriptButton[] = [];

    for (const button of buttons) {
      if (LEGACY_OPEN_MANAGER_BUTTONS.includes(button.name)) {
        if (!hasCurrentButton && !insertedCurrentButton) {
          nextButtons.push(managerButton(button, forceVisibleOnce));
          insertedCurrentButton = true;
        }
        continue;
      }

      if (button.name === OPEN_MANAGER_BUTTON) {
        if (!insertedCurrentButton) {
          nextButtons.push(managerButton(button, forceVisibleOnce));
          insertedCurrentButton = true;
        }
        continue;
      }

      nextButtons.push(button);
    }

    if (!insertedCurrentButton) {
      nextButtons.push(managerButton({}, true));
    }

    return nextButtons;
  });
}

$(window).on('pagehide', () => {
  buttonEventHandle?.stop();
  app.unmount();
  styleHandle?.destroy();
  $appRoot?.remove();
  buttonEventHandle = null;
  styleHandle = null;
  $appRoot = null;
});
