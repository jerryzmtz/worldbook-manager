const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const {
  CACHE_RECORDS_CHANGED_EVENT,
  cleanupCacheInspectorMonitorPatches,
  installCacheInspectorMonitor,
} = require('./monitor.ts');

const TARGET_API = '/api/backends/chat-completions/generate';
let originalFetch;
let originalConsoleInfo;
let originalConsoleWarn;
let originalConsoleLog;

test('captures normal SillyTavern fetch requests after completion', async () => {
  let resolveFetch;
  const routeResponse = new Promise(resolve => {
    resolveFetch = resolve;
  });
  const { stores } = installTestEnvironment(async () => {
    return routeResponse;
  });
  const changedEvents = [];
  window.dispatchEvent = event => {
    if (event.type === CACHE_RECORDS_CHANGED_EVENT) changedEvents.push(event.detail);
    return true;
  };
  const completedRouteResponse = () =>
    new Response(JSON.stringify({
      usage: {
        prompt_tokens_details: { cached_tokens: 7 },
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25,
      },
    }));
  const handle = installCacheInspectorMonitor();

  try {
    const fetchPromise = window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello cache' }],
      }),
    });
    await flushAsyncWork();

    assert.equal(changedEvents.length, 0);
    assert.equal(stores.summaryRecords.size, 0);
    resolveFetch(completedRouteResponse());
    await fetchPromise;
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'test-model');
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.hitTokens, 7);
    assert.equal(summary.totalTokens, 25);
    assert.ok(changedEvents.some(event => event.summary?.status === 'completed' && event.summary.id === summary.id));
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('can skip TauriTavern visible response fallback without cloning response bodies', async () => {
  let cloneCalled = false;
  let subscriber = null;
  const rawEntries = new Map();
  const response = new Response(JSON.stringify({
    usage: {
      prompt_tokens_details: { cached_tokens: 7 },
      prompt_tokens: 20,
      completion_tokens: 5,
      total_tokens: 25,
    },
  }));
  response.clone = () => {
    cloneCalled = true;
    throw new Error('response clone should not be used');
  };
  const { stores } = installTestEnvironment(async () => response);
  window.__TAURITAVERN__ = {
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor({ captureTauriVisibleResponseFallback: false });

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    const returnedResponse = await window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'metadata-only-model',
        messages: [{ role: 'user', content: 'metadata only' }],
      }),
    });
    await flushAsyncWork();

    assert.equal(returnedResponse, response);
    assert.equal(cloneCalled, false);
    rawEntries.set(1, {
      id: 1,
      requestRaw: JSON.stringify({
        model: 'metadata-only-model',
        messages: [{ role: 'user', content: 'metadata only' }],
      }),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 7 },
          prompt_tokens: 20,
          completion_tokens: 5,
          total_tokens: 25,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({
      id: 1,
      timestampMs: Date.now(),
      ok: true,
      source: 'openai',
      model: 'metadata-only-model',
      endpoint: 'https://example.test/v1/chat/completions',
      stream: true,
    });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'metadata-only-model');
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.hitTokens, 7);
    assert.equal(summary.totalTokens, 25);
    assert.equal(summary.errorMessage, null);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('cleans up stale monitor patches without the original handle', async () => {
  const routeFetch = async () => new Response('{}');
  installTestEnvironment(routeFetch);
  const handle = installCacheInspectorMonitor();

  try {
    const patchedFetch = window.fetch;
    assert.notEqual(patchedFetch, routeFetch);
    cleanupCacheInspectorMonitorPatches();
    assert.notEqual(window.fetch, patchedFetch);
    assert.equal(window.__wbmCacheInspectorPatchState, undefined);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('broadcasts completed record changes to same-origin parent windows', async () => {
  let resolveFetch;
  const routeResponse = new Promise(resolve => {
    resolveFetch = resolve;
  });
  installTestEnvironment(async () => routeResponse);
  const parentEvents = [];
  const parentWindow = {
    fetch: async () => new Response('{}'),
    location: { href: 'http://localhost/' },
    dispatchEvent: event => {
      if (event.type === CACHE_RECORDS_CHANGED_EVENT) parentEvents.push(event.detail);
      return true;
    },
    CustomEvent,
  };
  window.parent = parentWindow;
  window.top = parentWindow;
  const handle = installCacheInspectorMonitor();

  try {
    const fetchPromise = window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'parent-event-model',
        messages: [{ role: 'user', content: 'same origin parent event' }],
      }),
    });
    await flushAsyncWork();

    assert.equal(parentEvents.length, 0);
    resolveFetch(new Response(JSON.stringify({ usage: { prompt_tokens: 1, total_tokens: 1 } })));
    await fetchPromise;
    await flushAsyncWork();
    assert.ok(
      parentEvents.some(
        event => event.summary?.status === 'completed' && event.summary?.model === 'parent-event-model',
      ),
    );
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('broadcasts completed host-window captures back to the panel window', async () => {
  let resolveFetch;
  const routeResponse = new Promise(resolve => {
    resolveFetch = resolve;
  });
  installTestEnvironment(async () => new Response('{}'));
  const panelEvents = [];
  window.dispatchEvent = event => {
    if (event.type === CACHE_RECORDS_CHANGED_EVENT) panelEvents.push(event.detail);
    return true;
  };
  const parentWindow = {
    fetch: async () => routeResponse,
    location: { href: 'http://localhost/' },
    dispatchEvent: () => true,
    CustomEvent,
  };
  window.parent = parentWindow;
  window.top = parentWindow;
  const handle = installCacheInspectorMonitor();

  try {
    const fetchPromise = window.parent.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'host-event-model',
        messages: [{ role: 'user', content: 'host window request' }],
      }),
    });
    await flushAsyncWork();

    assert.equal(panelEvents.length, 0);
    resolveFetch(new Response(JSON.stringify({ usage: { prompt_tokens: 1, total_tokens: 1 } })));
    await fetchPromise;
    await flushAsyncWork();
    assert.ok(
      panelEvents.some(event => event.summary?.status === 'completed' && event.summary?.model === 'host-event-model'),
    );
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('reinstalls after TauriTavern replaces fetch before ready resolves', async () => {
  let replacementCalls = 0;
  let resolveReady;
  const ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  const { stores } = installTestEnvironment(async () => {
    return new Response(JSON.stringify({ usage: { prompt_tokens: 1, total_tokens: 1 } }));
  });
  window.__TAURITAVERN__ = { ready };
  const handle = installCacheInspectorMonitor();

  try {
    const tauriReplacementFetch = async () => {
      replacementCalls += 1;
      return new Response(JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 3 },
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      }));
    };
    window.fetch = tauriReplacementFetch;

    resolveReady();
    await flushAsyncWork();

    assert.notEqual(window.fetch, tauriReplacementFetch);
    await window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'tauri-model',
        messages: [{ role: 'user', content: 'after ready' }],
      }),
    });
    await flushAsyncWork();

    assert.equal(replacementCalls, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'tauri-model');
    assert.equal(summary.hitTokens, 3);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TauriTavern fetch route when Tauri patches after the monitor', async () => {
  let nativeCalls = 0;
  let tauriRouteCalls = 0;
  const { stores } = installTestEnvironment(async () => {
    nativeCalls += 1;
    return new Response(JSON.stringify({ usage: { prompt_tokens: 1, total_tokens: 1 } }));
  });
  const handle = installCacheInspectorMonitor();

  try {
    const fetchSeenByTauri = window.fetch;
    const tauriPatchedFetch = async (input, init) => {
      if (String(input).includes(TARGET_API)) {
        tauriRouteCalls += 1;
        return new Response(JSON.stringify({
          usage: {
            prompt_tokens_details: { cached_tokens: 9 },
            prompt_tokens: 18,
            completion_tokens: 4,
            total_tokens: 22,
          },
        }));
      }
      return fetchSeenByTauri(input, init);
    };

    window.fetch = tauriPatchedFetch;

    assert.notEqual(window.fetch, tauriPatchedFetch);
    await window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'tauri-route-model',
        messages: [{ role: 'user', content: 'direct tauri route' }],
      }),
    });
    await window.fetch('/api/not-captured');
    await flushAsyncWork();

    assert.equal(tauriRouteCalls, 1);
    assert.equal(nativeCalls, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'tauri-route-model');
    assert.equal(summary.hitTokens, 9);
    assert.equal(summary.totalTokens, 22);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TauriTavern jQuery ajax requests', async () => {
  let ajaxCalls = 0;
  const { stores } = installTestEnvironment(async () => {
    return new Response('{}');
  });
  installJQueryAjaxMock((..._args) => {
    ajaxCalls += 1;
    return createJqXHR({
      usage: {
        prompt_tokens_details: { cached_tokens: 11 },
        prompt_tokens: 21,
        completion_tokens: 8,
        total_tokens: 29,
      },
    });
  });
  const handle = installCacheInspectorMonitor();

  try {
    const jqXHR = window.$.ajax({
      url: TARGET_API,
      method: 'POST',
      data: JSON.stringify({
        model: 'ajax-model',
        messages: [{ role: 'user', content: 'ajax cache' }],
      }),
    });
    assert.ok(jqXHR);
    await flushAsyncWork();

    assert.equal(ajaxCalls, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'ajax-model');
    assert.equal(summary.hitTokens, 11);
    assert.equal(summary.totalTokens, 29);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TauriTavern ajax route when Tauri patches after the monitor', async () => {
  let nativeAjaxCalls = 0;
  let tauriRouteCalls = 0;
  const { stores } = installTestEnvironment(async () => {
    return new Response('{}');
  });
  installJQueryAjaxMock(() => {
    nativeAjaxCalls += 1;
    return createJqXHR({ usage: { prompt_tokens: 1, total_tokens: 1 } });
  });
  const handle = installCacheInspectorMonitor();

  try {
    const ajaxSeenByTauri = window.$.ajax;
    const tauriPatchedAjax = function tauriPatchedAjax(...args) {
      const firstArg = args[0];
      const url = typeof firstArg === 'string' ? firstArg : firstArg?.url;
      if (String(url).includes(TARGET_API)) {
        tauriRouteCalls += 1;
        return createJqXHR({
          usage: {
            prompt_tokens_details: { cached_tokens: 6 },
            prompt_tokens: 14,
            completion_tokens: 3,
            total_tokens: 17,
          },
        });
      }
      return ajaxSeenByTauri.apply(this, args);
    };

    window.$.ajax = tauriPatchedAjax;

    assert.notEqual(window.$.ajax, tauriPatchedAjax);
    await window.$.ajax({
      url: TARGET_API,
      method: 'POST',
      data: JSON.stringify({
        model: 'tauri-ajax-route-model',
        messages: [{ role: 'user', content: 'direct ajax route' }],
      }),
    });
    await window.$.ajax({ url: '/api/not-captured' });
    await flushAsyncWork();

    assert.equal(tauriRouteCalls, 1);
    assert.equal(nativeAjaxCalls, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'tauri-ajax-route-model');
    assert.equal(summary.hitTokens, 6);
    assert.equal(summary.totalTokens, 17);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('reinstalls after TauriTavern replaces jQuery ajax before ready resolves', async () => {
  let ajaxCalls = 0;
  let resolveReady;
  const ready = new Promise(resolve => {
    resolveReady = resolve;
  });
  const { stores } = installTestEnvironment(async () => {
    return new Response('{}');
  });
  installJQueryAjaxMock(() => createJqXHR({ usage: { prompt_tokens: 1, total_tokens: 1 } }));
  window.__TAURITAVERN__ = { ready };
  const handle = installCacheInspectorMonitor();

  try {
    const tauriReplacementAjax = function tauriReplacementAjax(..._args) {
      ajaxCalls += 1;
      return createJqXHR({
        usage: {
          prompt_tokens_details: { cached_tokens: 5 },
          prompt_tokens: 16,
          completion_tokens: 4,
          total_tokens: 20,
        },
      });
    };
    window.$.ajax = tauriReplacementAjax;
    window.jQuery.ajax = tauriReplacementAjax;

    resolveReady();
    await flushAsyncWork();

    assert.notEqual(window.$.ajax, tauriReplacementAjax);
    await window.$.ajax({
      url: TARGET_API,
      method: 'POST',
      data: JSON.stringify({
        model: 'tauri-ajax-model',
        messages: [{ role: 'user', content: 'after ajax ready' }],
      }),
    });
    await flushAsyncWork();

    assert.equal(ajaxCalls, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'tauri-ajax-model');
    assert.equal(summary.hitTokens, 5);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures XMLHttpRequest requests when the host bypasses fetch and jQuery ajax', async () => {
  let xhrCalls = 0;
  const { stores } = installTestEnvironment(async () => {
    return new Response('{}');
  });
  window.XMLHttpRequest = createXMLHttpRequestMock(() => {
    xhrCalls += 1;
    return {
      status: 200,
      statusText: 'OK',
      responseText: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 13 },
          prompt_tokens: 21,
          completion_tokens: 6,
          total_tokens: 27,
        },
      }),
    };
  });
  const handle = installCacheInspectorMonitor();

  try {
    const xhr = new window.XMLHttpRequest();
    xhr.open('POST', TARGET_API);
    xhr.send(JSON.stringify({
      model: 'xhr-model',
      messages: [{ role: 'user', content: 'xhr cache' }],
    }));
    await flushAsyncWork();

    assert.equal(xhrCalls, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'xhr-model');
    assert.equal(summary.hitTokens, 13);
    assert.equal(summary.totalTokens, 27);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('leaves TavernHelper.generateRaw unpatched unless host-function capture is enabled', async () => {
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  window.TavernHelper = {
    generateRaw: async () => 'plain result',
  };
  const originalGenerateRaw = window.TavernHelper.generateRaw;
  const handle = installCacheInspectorMonitor();

  try {
    assert.equal(window.TavernHelper.generateRaw, originalGenerateRaw);
    const result = await window.TavernHelper.generateRaw({ ordered_prompts: [{ role: 'user', content: 'plain' }] });
    await flushAsyncWork();

    assert.equal(result, 'plain result');
    assert.equal(stores.summaryRecords.size, 0);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TavernHelper.generateRaw requests even when no fetch is visible', async () => {
  let fetchCalls = 0;
  const { stores } = installTestEnvironment(async () => {
    fetchCalls += 1;
    return new Response('{}');
  });
  enableHostFunctionCapture();
  window.TavernHelper = {
    generateRaw: async options => {
      assert.equal(options.should_stream, false);
      return 'table edit result';
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    const result = await window.TavernHelper.generateRaw({
      ordered_prompts: [
        { role: 'system', content: 'database fill system prompt' },
        { role: 'user', content: 'current table data' },
      ],
      should_stream: false,
    });
    await flushAsyncWork();

    assert.equal(result, 'table edit result');
    assert.equal(fetchCalls, 0);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.messageCount, 2);
    assert.equal(summary.promptChars, 'database fill system prompt'.length + 'current table data'.length);
    assert.equal(summary.errorMessage, '无缓存明细');
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('hydrates TavernHelper.generateRaw captures from nested fetch usage without duplicating records', async () => {
  const { stores } = installTestEnvironment(async () => {
    return new Response(JSON.stringify({
      usage: {
        prompt_tokens_details: { cached_tokens: 6 },
        prompt_tokens: 10,
        completion_tokens: 3,
        total_tokens: 13,
      },
    }));
  });
  enableHostFunctionCapture();
  window.TavernHelper = {
    generateRaw: async options => {
      await window.fetch(TARGET_API, {
        method: 'POST',
        body: JSON.stringify({
          model: 'nested-fetch-model',
          messages: options.ordered_prompts,
        }),
      });
      return 'nested result';
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    const result = await window.TavernHelper.generateRaw({
      ordered_prompts: [
        { role: 'system', content: 'database nested system prompt' },
        { role: 'user', content: 'database nested table data' },
      ],
    });
    await flushAsyncWork();

    assert.equal(result, 'nested result');
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, '当前模型');
    assert.equal(summary.hitTokens, 6);
    assert.equal(summary.totalTokens, 13);
    assert.equal(summary.errorMessage, null);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures ConnectionManagerRequestService requests when no fetch is visible', async () => {
  const context = {
    ConnectionManagerRequestService: {
      sendRequest: async (_profileId, prompt) => {
        assert.equal(prompt[0].content, 'connection manager prompt');
        return { content: 'connection manager result' };
      },
    },
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  enableHostFunctionCapture();
  window.SillyTavern = {
    getContext: () => context,
  };
  const handle = installCacheInspectorMonitor();

  try {
    const result = await context.ConnectionManagerRequestService.sendRequest(
      'profile-id',
      [{ role: 'user', content: 'connection manager prompt' }],
      1024,
    );
    await flushAsyncWork();

    assert.deepEqual(result, { content: 'connection manager result' });
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.promptChars, 'connection manager prompt'.length);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TavernHelper.generateRaw requests from same-origin sibling iframes', async () => {
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  enableHostFunctionCapture();
  const siblingWindow = {
    location: { href: 'http://localhost/scripts/extensions/third-party/database/' },
    dispatchEvent: () => true,
    TavernHelper: {
      generateRaw: async options => {
        assert.equal(options.ordered_prompts[0].content, 'iframe database prompt');
        return 'iframe table result';
      },
    },
  };
  siblingWindow.parent = window;
  siblingWindow.top = window;
  siblingWindow.document = { querySelectorAll: () => [] };
  window.document = {
    querySelectorAll: selector => {
      assert.equal(selector, 'iframe,frame');
      return [{ contentWindow: siblingWindow }];
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    const result = await siblingWindow.TavernHelper.generateRaw({
      ordered_prompts: [{ role: 'user', content: 'iframe database prompt' }],
    });
    await flushAsyncWork();

    assert.equal(result, 'iframe table result');
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.promptChars, 'iframe database prompt'.length);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TauriTavern native LLM API logs without relying on fetch patching', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  let fetchCalls = 0;
  let resolveFetch;
  const routeResponse = new Promise(resolve => {
    resolveFetch = resolve;
  });
  const { stores } = installTestEnvironment(async () => {
    fetchCalls += 1;
    return routeResponse;
  });
  const completedRouteResponse = () =>
    new Response(JSON.stringify({
      usage: {
        prompt_tokens_details: { cached_tokens: 1 },
        prompt_tokens: 2,
        total_tokens: 2,
      },
    }));
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    const fetchPromise = window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'fetch-should-not-duplicate',
        messages: [{ role: 'user', content: 'fetch ignored when native log active' }],
      }),
    });
    await flushAsyncWork();
    assert.equal(fetchCalls, 1);
    assert.equal(stores.summaryRecords.size, 0);
    resolveFetch(completedRouteResponse());
    await fetchPromise;

    rawEntries.set(1, {
      id: 1,
      requestRaw: JSON.stringify({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: 'native gemini payload' }] }],
      }),
      responseRaw: JSON.stringify({
        usageMetadata: {
          cachedContentTokenCount: 8,
          promptTokenCount: 20,
          candidatesTokenCount: 5,
          totalTokenCount: 25,
        },
      }),
      responseRawKind: 'json',
    });

    subscriber({
      id: 1,
      timestampMs: Date.now(),
      ok: true,
      source: 'gemini',
      model: 'gemini-3-flash-preview',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
      stream: false,
    });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'gemini-3-flash-preview');
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.hitTokens, 8);
    assert.equal(summary.totalTokens, 25);
    assert.equal(summary.snapshotAvailable, true);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TauriTavern native logs in lightweight mode without request hooks', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const fetchImpl = async () => new Response('{}');
  const invokeImpl = async () => ({ ok: true });
  const { stores } = installTestEnvironment(fetchImpl);
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    invoke: {
      broker: {
        invoke: invokeImpl,
      },
    },
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor({
    captureBrowserRequestHooks: false,
    captureTauriInvokeBroker: false,
    captureTauriVisibleResponseFallback: false,
  });

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');
    assert.equal(window.fetch, fetchImpl);
    assert.equal(window.__TAURITAVERN__.invoke.broker.invoke, invokeImpl);

    rawEntries.set(1, {
      id: 1,
      requestRaw: JSON.stringify({
        model: 'native-only-model',
        messages: [{ role: 'user', content: 'native only should still capture' }],
      }),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 9 },
          prompt_tokens: 30,
          completion_tokens: 4,
          total_tokens: 34,
        },
      }),
      responseRawKind: 'json',
    });

    subscriber({
      id: 1,
      timestampMs: Date.now(),
      ok: true,
      source: 'openai',
      model: 'native-only-model',
      endpoint: 'https://example.test/v1/chat/completions',
      stream: false,
    });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'native-only-model');
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.hitTokens, 9);
    assert.equal(summary.totalTokens, 34);
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('does not touch request hook surfaces in TauriTavern lightweight mode', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const hookTouches = [];
  const fetchImpl = async () => new Response('{}');
  const ajaxImpl = async () => ({});
  const xhrImpl = function XMLHttpRequestMock() {};
  const invokeImpl = async () => ({ ok: true });
  const { stores } = installTestEnvironment(fetchImpl);
  const jqueryProxy = new Proxy({ ajax: ajaxImpl }, {
    defineProperty(target, property, descriptor) {
      if (property === 'ajax') hookTouches.push(`define:${String(property)}`);
      return Reflect.defineProperty(target, property, descriptor);
    },
    set(target, property, value, receiver) {
      if (property === 'ajax') hookTouches.push(`set:${String(property)}`);
      return Reflect.set(target, property, value, receiver);
    },
  });
  const windowTarget = {
    ...window,
    $: jqueryProxy,
    jQuery: jqueryProxy,
    XMLHttpRequest: xhrImpl,
    __TAURITAVERN__: {
      ready: Promise.resolve(),
      invoke: {
        broker: {
          invoke: invokeImpl,
        },
      },
      api: {
        dev: {
          llmApiLogs: {
            index: async () => [],
            getRaw: async id => rawEntries.get(id),
            subscribeIndex: async handler => {
              subscriber = handler;
              return () => {};
            },
          },
        },
      },
    },
  };
  const windowProxy = new Proxy(windowTarget, {
    defineProperty(target, property, descriptor) {
      if (property === 'fetch' || property === 'XMLHttpRequest') hookTouches.push(`define:${String(property)}`);
      return Reflect.defineProperty(target, property, descriptor);
    },
    set(target, property, value, receiver) {
      if (property === 'fetch' || property === 'XMLHttpRequest') hookTouches.push(`set:${String(property)}`);
      return Reflect.set(target, property, value, receiver);
    },
  });
  windowProxy.parent = windowProxy;
  windowProxy.top = windowProxy;
  globalThis.window = windowProxy;

  const handle = installCacheInspectorMonitor({
    captureBrowserRequestHooks: false,
    captureTauriInvokeBroker: false,
    captureTauriVisibleResponseFallback: false,
  });

  try {
    await flushAsyncWork();
    assert.deepEqual(hookTouches, []);
    assert.equal(window.fetch, fetchImpl);
    assert.equal(window.$.ajax, ajaxImpl);
    assert.equal(window.XMLHttpRequest, xhrImpl);
    assert.equal(window.__TAURITAVERN__.invoke.broker.invoke, invokeImpl);
    assert.equal(typeof subscriber, 'function');

    rawEntries.set(1, {
      id: 1,
      requestRaw: JSON.stringify({
        model: 'native-only-no-hooks-model',
        messages: [{ role: 'user', content: 'native only no hook touch' }],
      }),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 11 },
          prompt_tokens: 40,
          total_tokens: 40,
        },
      }),
      responseRawKind: 'json',
    });

    subscriber({
      id: 1,
      timestampMs: Date.now(),
      ok: true,
      source: 'openai',
      model: 'native-only-no-hooks-model',
      endpoint: 'https://example.test/v1/chat/completions',
      stream: false,
    });
    await flushAsyncWork();

    assert.deepEqual(hookTouches, []);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'native-only-no-hooks-model');
    assert.equal(summary.hitTokens, 11);
    assert.equal(summary.totalTokens, 40);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('does not install SillyTavern host-function patches inside TauriTavern', async () => {
  let helperCalls = 0;
  let serviceCalls = 0;
  const context = {
    ConnectionManagerRequestService: {
      sendRequest: () => {
        serviceCalls += 1;
        return { usage: { prompt_tokens_details: { cached_tokens: 5 }, prompt_tokens: 10, total_tokens: 10 } };
      },
    },
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  enableHostFunctionCapture();
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    invoke: {
      broker: {
        invoke: async () => ({ started: true }),
      },
    },
  };
  window.TavernHelper = {
    generateRaw: () => {
      helperCalls += 1;
      return { usage: { prompt_tokens_details: { cached_tokens: 4 }, prompt_tokens: 8, total_tokens: 8 } };
    },
  };
  window.SillyTavern = {
    getContext: () => context,
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();

    window.TavernHelper.generateRaw('helper prompt');
    context.ConnectionManagerRequestService.sendRequest({ prompt: 'service prompt' });
    await flushAsyncWork();

    assert.equal(helperCalls, 1);
    assert.equal(serviceCalls, 1);
    assert.equal(stores.summaryRecords.size, 0);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures visible SillyTavern fetch responses when no TauriTavern native log API exists', async () => {
  const payload = {
    model: 'st-visible-response-model',
    messages: [{ role: 'user', content: 'visible response should complete pending' }],
  };
  const { stores } = installTestEnvironment(async () => {
    return new Response(JSON.stringify({
      usage: {
        prompt_tokens_details: { cached_tokens: 4 },
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      },
    }));
  });
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();

    await window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'st-visible-response-model');
    assert.equal(summary.hitTokens, 4);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures multiple TauriTavern native log entries independently', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const firstPayload = {
    model: 'first-native-model',
    messages: [{ role: 'user', content: 'first native payload' }],
  };
  const secondPayload = {
    model: 'second-native-model',
    messages: [{ role: 'user', content: 'second native payload' }],
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    rawEntries.set(31, {
      id: 31,
      requestRaw: JSON.stringify(firstPayload),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 12 },
          prompt_tokens: 20,
          completion_tokens: 4,
          total_tokens: 24,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({ id: 31, timestampMs: Date.now(), ok: true, stream: false });
    await flushAsyncWork();

    rawEntries.set(32, {
      id: 32,
      requestRaw: JSON.stringify(secondPayload),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 18 },
          prompt_tokens: 22,
          completion_tokens: 5,
          total_tokens: 27,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({ id: 32, timestampMs: Date.now(), ok: true, stream: false });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 2);
    const summaries = Array.from(stores.summaryRecords.values());
    const firstSummary = summaries.find(summary => summary.model === 'first-native-model');
    const secondSummary = summaries.find(summary => summary.model === 'second-native-model');
    assert.equal(firstSummary.status, 'completed');
    assert.equal(firstSummary.hitTokens, 12);
    assert.equal(secondSummary.status, 'completed');
    assert.equal(secondSummary.hitTokens, 18);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('reconciles TauriTavern native logs with stored pending records when the in-memory queue missed them', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const now = Date.now();
  const pendingId = 'stored-tt-pending';
  const payload = {
    model: 'stored-native-model',
    messages: [{ role: 'user', content: 'stored native prompt' }],
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  stores.summaryRecords.set(pendingId, {
    id: pendingId,
    timestamp: now - 1200,
    status: 'pending',
    model: 'stored-native-model',
    messageCount: 1,
    promptChars: 'stored native prompt'.length,
    snapshotAvailable: true,
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
  });
  stores.promptSnapshots.set(pendingId, {
    id: pendingId,
    timestamp: now - 1200,
    messages: [{ role: 'user', text: 'stored native prompt', hash: 'stored-native-prompt-hash' }],
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    rawEntries.set(41, {
      id: 41,
      requestRaw: JSON.stringify(payload),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 15 },
          prompt_tokens: 25,
          completion_tokens: 3,
          total_tokens: 28,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({ id: 41, timestampMs: now, ok: true, stream: false });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const summary = stores.summaryRecords.get(pendingId);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'stored-native-model');
    assert.equal(summary.hitTokens, 15);
    assert.equal(summary.totalTokens, 28);
    assert.equal(stores.promptSnapshots.get(pendingId).messages[0].text, 'stored native prompt');
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('reconciles TauriTavern native logs with no-usage fallback records', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const now = Date.now();
  const fallbackId = 'stored-tt-no-usage-fallback';
  const nativePayload = {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'native direct request payload' }],
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  stores.summaryRecords.set(fallbackId, {
    id: fallbackId,
    timestamp: now - 1500,
    status: 'completed',
    model: 'deepseek-v4-flash',
    messageCount: 2,
    promptChars: 225248,
    snapshotAvailable: false,
    hitTokens: 0,
    missTokens: 0,
    totalCacheTokens: 0,
    hitRate: null,
    outputTokens: 0,
    totalTokens: 0,
    rawUsage: null,
    pricingSnapshot: null,
    costSnapshot: null,
    errorMessage: '未返回缓存数据',
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    rawEntries.set(43, {
      id: 43,
      requestRaw: JSON.stringify(nativePayload),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 77 },
          prompt_tokens: 101,
          completion_tokens: 9,
          total_tokens: 110,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({ id: 43, timestampMs: now, ok: true, stream: false });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const summary = stores.summaryRecords.get(fallbackId);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.hitTokens, 77);
    assert.equal(summary.totalTokens, 110);
    assert.equal(summary.errorMessage, null);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('deduplicates completed visible TauriTavern fallback records when native logs arrive later', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const now = Date.now();
  const visibleId = 'stored-tt-visible-completed';
  const visibleUsage = {
    prompt_tokens_details: { cached_tokens: 83_000 },
    prompt_tokens: 89_500,
    completion_tokens: 1200,
    total_tokens: 90_700,
  };
  const nativePayload = {
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: 'native system prompt' },
      { role: 'user', content: 'native user prompt' },
    ],
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  stores.summaryRecords.set(visibleId, {
    id: visibleId,
    timestamp: now - 1200,
    status: 'completed',
    model: 'deepseek-v4-pro',
    messageCount: 2,
    promptChars: 141_991,
    snapshotAvailable: true,
    hitTokens: 83_000,
    missTokens: 6_500,
    totalCacheTokens: 89_500,
    hitRate: 83_000 / 89_500,
    outputTokens: 1200,
    totalTokens: 90_700,
    rawUsage: visibleUsage,
    pricingSnapshot: null,
    costSnapshot: null,
    errorMessage: null,
  });
  stores.promptSnapshots.set(visibleId, {
    id: visibleId,
    timestamp: now - 1200,
    messages: [{ role: 'user', text: 'visible fallback prompt', length: 23, hash: 'visible' }],
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    rawEntries.set(44, {
      id: 44,
      requestRaw: JSON.stringify(nativePayload),
      responseRaw: JSON.stringify({ usage: visibleUsage }),
      responseRawKind: 'json',
    });
    subscriber({ id: 44, timestampMs: now, ok: true, stream: true });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const summary = stores.summaryRecords.get(visibleId);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'deepseek-v4-pro');
    assert.equal(summary.messageCount, 2);
    assert.equal(summary.promptChars, 'native system prompt'.length + 'native user prompt'.length);
    assert.equal(summary.hitTokens, 83_000);
    assert.equal(summary.totalTokens, 90_700);
    assert.equal(stores.promptSnapshots.get(visibleId).messages[0].text, 'native system prompt');
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('recovers stored TauriTavern pending records from historical index entries', async () => {
  let rawAttempts = 0;
  const oldTimestamp = Date.now() - 60_000;
  const pendingId = 'stored-tt-historical-pending';
  const payload = {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'historical native payload' }],
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  stores.summaryRecords.set(pendingId, {
    id: pendingId,
    timestamp: oldTimestamp,
    status: 'pending',
    model: 'deepseek-v4-flash',
    messageCount: 1,
    promptChars: 'historical native payload'.length,
    snapshotAvailable: false,
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
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [{ id: 44, timestampMs: oldTimestamp, ok: true, model: 'deepseek-v4-flash', stream: false }],
          getRaw: async id => {
            rawAttempts += 1;
            return {
              id,
              requestRaw: JSON.stringify(payload),
              responseRaw: JSON.stringify({
                usage: {
                  prompt_tokens_details: { cached_tokens: 33 },
                  prompt_tokens: 40,
                  completion_tokens: 5,
                  total_tokens: 45,
                },
              }),
              responseRawKind: 'json',
            };
          },
          subscribeIndex: async () => () => {},
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(rawAttempts, 1);
    assert.equal(stores.summaryRecords.size, 1);
    const summary = stores.summaryRecords.get(pendingId);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.hitTokens, 33);
    assert.equal(summary.totalTokens, 45);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('reconciles TauriTavern stored pending records when browser and native payload shapes differ', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const now = Date.now();
  const pendingId = 'stored-tt-shape-mismatch';
  const nativePayload = {
    model: 'deepseek-v4-flash',
    messages: Array.from({ length: 9 }, (_, index) => ({ role: 'user', content: `native prompt ${index}` })),
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  stores.summaryRecords.set(pendingId, {
    id: pendingId,
    timestamp: now - 1800,
    status: 'pending',
    model: 'deepseek-v4-flash',
    messageCount: 59,
    promptChars: 297548,
    snapshotAvailable: false,
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
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    rawEntries.set(42, {
      id: 42,
      requestRaw: JSON.stringify(nativePayload),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 1024 },
          prompt_tokens: 2048,
          completion_tokens: 64,
          total_tokens: 2112,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({ id: 42, timestampMs: now, ok: true, stream: false });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const summary = stores.summaryRecords.get(pendingId);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.messageCount, 9);
    assert.equal(summary.promptChars, nativePayload.messages.reduce((sum, message) => sum + message.content.length, 0));
    assert.equal(summary.hitTokens, 1024);
    assert.equal(summary.totalTokens, 2112);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('uses transformed TauriTavern native payloads instead of browser-route pending payloads', async () => {
  let subscriber = null;
  const rawEntries = new Map();
  const fetchResolvers = [];
  const { stores } = installTestEnvironment(async () => {
    return new Promise(resolve => {
      fetchResolvers.push(resolve);
    });
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    const firstFetch = window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'same-native-model',
        messages: [{ role: 'user', content: 'browser first prompt' }],
      }),
    });
    await wait(5);
    const secondFetch = window.fetch(TARGET_API, {
      method: 'POST',
      body: JSON.stringify({
        model: 'same-native-model',
        messages: [{ role: 'user', content: 'browser second prompt' }],
      }),
    });
    await wait(10);
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 0);

    rawEntries.set(41, {
      id: 41,
      requestRaw: JSON.stringify({
        model: 'same-native-model',
        messages: [{ role: 'user', content: 'native transformed prompt text' }],
      }),
      responseRaw: JSON.stringify({
        usage: {
          prompt_tokens_details: { cached_tokens: 16 },
          prompt_tokens: 20,
          completion_tokens: 3,
          total_tokens: 23,
        },
      }),
      responseRawKind: 'json',
    });
    subscriber({ id: 41, timestampMs: Date.now(), ok: true, stream: true });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'same-native-model');
    assert.equal(summary.promptChars, 'native transformed prompt text'.length);
    assert.equal(summary.hitTokens, 16);
    assert.equal(summary.snapshotAvailable, true);
    assert.equal(stores.promptSnapshots.size, 1);

    fetchResolvers.forEach(resolve =>
      resolve(new Response(JSON.stringify({ usage: { prompt_tokens: 1, total_tokens: 1 } }))),
    );
    await Promise.all([firstFetch, secondFetch]);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('captures TauriTavern native invoke records when route fetch is not visible', async () => {
  let subscriber = null;
  let resolveInvoke;
  const rawEntries = new Map();
  const invokeResult = new Promise(resolve => {
    resolveInvoke = resolve;
  });
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  const changedEvents = [];
  window.dispatchEvent = event => {
    if (event.type === CACHE_RECORDS_CHANGED_EVENT) changedEvents.push(event.detail);
    return true;
  };
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    invoke: {
      broker: {
        invoke: async () => invokeResult,
      },
    },
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => rawEntries.get(id),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const payload = {
    model: 'invoke-stream-model',
    stream: true,
    messages: [{ role: 'user', content: 'native invoke stream payload' }],
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(typeof subscriber, 'function');

    const startPromise = window.__TAURITAVERN__.invoke.broker.invoke('start_chat_completion_stream', {
      streamId: 'stream-1',
      dto: payload,
    });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 0);
    assert.equal(changedEvents.length, 0);

    resolveInvoke({ started: true });
    await startPromise;

    rawEntries.set(3, {
      id: 3,
      requestRaw: JSON.stringify(payload),
      responseRaw: [
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: {"usage":{"prompt_cache_hit_tokens":12,"prompt_tokens":20,"completion_tokens":4,"total_tokens":24}}',
        'data: [DONE]',
      ].join('\n'),
      responseRawKind: 'sse',
    });
    subscriber({ id: 3, timestampMs: Date.now(), ok: true, stream: true });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'invoke-stream-model');
    assert.equal(summary.hitTokens, 12);
    assert.equal(summary.totalTokens, 24);
    assert.equal(summary.snapshotAvailable, true);
    assert.ok(changedEvents.some(event => event.summary?.status === 'completed' && event.summary.id === summary.id));
    assert.equal(stores.promptSnapshots.size, 1);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('retries TauriTavern native raw log reads because the event can arrive before raw files persist', async () => {
  let subscriber = null;
  let rawAttempts = 0;
  const { stores } = installTestEnvironment(async () => {
    return new Response('{}');
  });
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => {
            rawAttempts += 1;
            if (rawAttempts === 1) throw new Error(`raw ${id} not ready`);
            return {
              id,
              requestRaw: JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: [{ role: 'user', content: 'native stream payload' }],
              }),
              responseRaw: [
                'data: {"choices":[{"delta":{"content":"ok"}}]}',
                'data: {"usage":{"prompt_cache_hit_tokens":6,"prompt_tokens":14,"completion_tokens":3,"total_tokens":17}}',
                'data: [DONE]',
              ].join('\n'),
              responseRawKind: 'sse',
            };
          },
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    subscriber({ id: 2, timestampMs: 1710000001000, ok: true, stream: true });
    await wait(140);
    await flushAsyncWork();

    assert.equal(rawAttempts, 2);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'deepseek-v4-flash');
    assert.equal(summary.hitTokens, 6);
    assert.equal(summary.totalTokens, 17);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('extracts TauriTavern stream usage from bare JSON SSE log lines', async () => {
  let subscriber = null;
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [],
          getRaw: async id => ({
            id,
            requestRaw: JSON.stringify({
              model: 'deepseek-v4-flash',
              stream: true,
              messages: [{ role: 'user', content: 'direct non-agent stream payload' }],
            }),
            responseRaw: [
              '{"choices":[{"delta":{"content":"ok"}}]}',
              '{"usage":{"prompt_cache_hit_tokens":12,"prompt_cache_miss_tokens":1880,"prompt_tokens":1892,"completion_tokens":102,"total_tokens":1994}}',
              '[DONE]',
            ].join('\n'),
            responseRawKind: 'sse',
          }),
          subscribeIndex: async handler => {
            subscriber = handler;
            return () => {};
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    subscriber({ id: 12, timestampMs: Date.now(), ok: true, stream: true });
    await flushAsyncWork();

    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'deepseek-v4-flash');
    assert.equal(summary.hitTokens, 12);
    assert.equal(summary.missTokens, 1880);
    assert.equal(summary.outputTokens, 102);
    assert.equal(summary.totalTokens, 1994);
    assert.equal(summary.errorMessage, null);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('polls TauriTavern native log index without subscription support', async () => {
  let rawAttempts = 0;
  let indexCalls = 0;
  let exposeLog = false;
  const payload = {
    model: 'indexed-native-log-model',
    stream: true,
    messages: [{ role: 'user', content: 'indexed native raw payload' }],
  };
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => {
            indexCalls += 1;
            return exposeLog ? [{ id: 9, timestampMs: Date.now(), ok: true, stream: true }] : [];
          },
          getRaw: async id => {
            rawAttempts += 1;
            return {
              id,
              requestRaw: JSON.stringify(payload),
              responseRaw: [
                'data: {"choices":[{"delta":{"content":"ok"}}]}',
                'data: {"usage":{"prompt_cache_hit_tokens":21,"prompt_tokens":30,"completion_tokens":5,"total_tokens":35}}',
                'data: [DONE]',
              ].join('\n'),
              responseRawKind: 'sse',
            };
          },
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(stores.summaryRecords.size, 0);
    assert.ok(indexCalls >= 1);

    exposeLog = true;
    await wait(1300);
    await flushAsyncWork();

    assert.ok(indexCalls >= 2);
    assert.ok(rawAttempts >= 1);
    assert.equal(stores.summaryRecords.size, 1);
    const [summary] = stores.summaryRecords.values();
    assert.equal(summary.status, 'completed');
    assert.equal(summary.model, 'indexed-native-log-model');
    assert.equal(summary.hitTokens, 21);
    assert.equal(summary.totalTokens, 35);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

test('does not hydrate historical TauriTavern index entries on panel startup', async () => {
  let rawAttempts = 0;
  const oldTimestamp = Date.now() - 60_000;
  const { stores } = installTestEnvironment(async () => new Response('{}'));
  window.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      dev: {
        llmApiLogs: {
          index: async () => [{ id: 99, timestampMs: oldTimestamp, ok: true, stream: false }],
          getRaw: async id => {
            rawAttempts += 1;
            return {
              id,
              requestRaw: JSON.stringify({
                model: 'old-index-model',
                messages: [{ role: 'user', content: 'old historical prompt' }],
              }),
              responseRaw: JSON.stringify({
                usage: {
                  prompt_tokens_details: { cached_tokens: 1 },
                  prompt_tokens: 2,
                  total_tokens: 2,
                },
              }),
              responseRawKind: 'json',
            };
          },
          subscribeIndex: async () => () => {},
        },
      },
    },
  };
  const handle = installCacheInspectorMonitor();

  try {
    await flushAsyncWork();
    assert.equal(rawAttempts, 0);
    assert.equal(stores.summaryRecords.size, 0);
  } finally {
    handle.destroy();
    cleanupTestEnvironment();
  }
});

function installTestEnvironment(fetchImpl) {
  originalFetch = globalThis.fetch;
  originalConsoleInfo = console.info;
  originalConsoleWarn = console.warn;
  originalConsoleLog = console.log;
  console.info = () => {};
  console.warn = () => {};
  console.log = () => {};
  globalThis.fetch = async url => {
    if (String(url).includes('frankfurter') || String(url).includes('open.er-api')) {
      return new Response(JSON.stringify({ rates: { CNY: 6.8032 } }));
    }
    return fetchImpl(url);
  };

  const stores = createStores();
  const testWindow = {
    fetch: fetchImpl,
    location: { href: 'http://localhost/' },
    dispatchEvent: () => true,
  };
  testWindow.parent = testWindow;
  testWindow.top = testWindow;

  globalThis.window = testWindow;
  globalThis.indexedDB = createIndexedDbMock(stores);
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };

  return { stores };
}

function installJQueryAjaxMock(ajaxImpl) {
  const jquery = { ajax: ajaxImpl };
  window.$ = jquery;
  window.jQuery = jquery;
}

function enableHostFunctionCapture() {
  window.__WBM_CACHE_INSPECTOR_HOST_FUNCTION_CAPTURE__ = true;
}

function cleanupTestEnvironment() {
  globalThis.fetch = originalFetch;
  originalFetch = undefined;
  console.info = originalConsoleInfo;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
  originalConsoleInfo = undefined;
  originalConsoleWarn = undefined;
  originalConsoleLog = undefined;
  delete globalThis.window;
  delete globalThis.indexedDB;
  delete globalThis.CustomEvent;
}

function createStores() {
  return {
    summaryRecords: new Map(),
    promptSnapshots: new Map(),
  };
}

function createIndexedDbMock(stores) {
  const db = {
    objectStoreNames: {
      contains: storeName => storeName in stores,
    },
    createObjectStore: storeName => createObjectStore(stores, storeName),
    transaction: storeNames => createTransaction(stores, storeNames),
    close: () => {},
  };

  return {
    open: () => {
      const request = createRequest(db);
      queueMicrotask(() => {
        request.transaction = createTransaction(stores, Object.keys(stores));
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function createTransaction(stores, storeNames) {
  const transaction = {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore: storeName => createObjectStore(stores, storeName),
    abort: () => {
      transaction.onabort?.();
    },
  };

  queueMicrotask(() => transaction.oncomplete?.());
  return transaction;
}

function createObjectStore(stores, storeName) {
  const store = stores[storeName];
  if (!store) throw new Error(`Unknown store: ${storeName}`);

  return {
    createIndex: () => {},
    index: () => ({
      openCursor: (_query, direction) => createCursorRequest(
        Array.from(store.values())
          .map(cloneValue)
          .sort((left, right) =>
            direction === 'prev' ? right.timestamp - left.timestamp : left.timestamp - right.timestamp,
          ),
      ),
    }),
    indexNames: {
      contains: name => name === 'timestamp',
    },
    openCursor: (_query, direction) => createCursorRequest(
      Array.from(store.values())
        .map(cloneValue)
        .sort((left, right) =>
          direction === 'prev' ? right.timestamp - left.timestamp : left.timestamp - right.timestamp,
        ),
    ),
    put: value => {
      store.set(value.id, structuredClone(value));
      return createRequest(value.id);
    },
    get: id => createRequest(cloneValue(store.get(id))),
    getAll: () => createRequest(Array.from(store.values()).map(cloneValue)),
    clear: () => {
      store.clear();
      return createRequest(undefined);
    },
    delete: id => {
      store.delete(id);
      return createRequest(undefined);
    },
  };
}

function createCursorRequest(values) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  let index = 0;

  const advance = () => {
    queueMicrotask(() => {
      const value = values[index];
      request.result = value === undefined
        ? null
        : {
            value: cloneValue(value),
            continue: () => {
              index += 1;
              advance();
            },
          };
      request.onsuccess?.();
    });
  };

  advance();
  return request;
}

function createRequest(result) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    transaction: null,
  };

  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

async function flushAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createJqXHR(data) {
  const responseText = JSON.stringify(data);
  return {
    responseText,
    done(callback) {
      queueMicrotask(() => callback(data, 'success', { responseText }));
      return this;
    },
    fail() {
      return this;
    },
    then(resolve) {
      queueMicrotask(() => resolve(data));
      return Promise.resolve(data);
    },
  };
}

function createXMLHttpRequestMock(responseFactory) {
  return class MockXMLHttpRequest {
    static UNSENT = 0;
    static OPENED = 1;
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;

    status = 0;
    statusText = '';
    responseText = '';
    listeners = new Map();
    url = '';

    open(_method, url) {
      this.url = String(url);
    }

    send(_body) {
      const response = responseFactory(this.url);
      this.status = response.status;
      this.statusText = response.statusText;
      this.responseText = response.responseText;
      queueMicrotask(() => this.dispatch('loadend'));
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) ?? [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }

    dispatch(type) {
      for (const callback of this.listeners.get(type) ?? []) callback.call(this);
    }
  };
}
