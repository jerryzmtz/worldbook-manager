const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

test('uses 6.8032 as the USD/CNY fallback rate', () => {
  const { module } = installExchangeRateTestEnvironment();

  try {
    assert.equal(module.FALLBACK_USD_TO_CNY_RATE, 6.8032);
    assert.equal(module.getUsdToCnyRate(), 6.8032);
    assert.equal(module.getUsdToCnyRateSnapshot().source, 'fallback');
  } finally {
    cleanupExchangeRateTestEnvironment();
  }
});

test('refreshes USD/CNY rate from Frankfurter and caches it', async () => {
  const { module, storage, events } = installExchangeRateTestEnvironment({
    fetchImpl: async url => {
      assert.match(String(url), /frankfurter\.dev\/v2\/rate\/USD\/CNY/u);
      return new Response(JSON.stringify({ rate: 7.1234 }));
    },
  });

  try {
    const snapshot = await module.refreshUsdToCnyRate(true);

    assert.equal(snapshot.rate, 7.1234);
    assert.equal(snapshot.source, 'frankfurter');
    assert.equal(module.getUsdToCnyRate(), 7.1234);
    assert.equal(JSON.parse(storage.get('worldbookCacheInspectorUsdToCnyRate')).rate, 7.1234);
    assert.equal(events.length, 1);
  } finally {
    cleanupExchangeRateTestEnvironment();
  }
});

test('falls back to open.er-api when Frankfurter does not return a valid rate', async () => {
  let requestCount = 0;
  const { module } = installExchangeRateTestEnvironment({
    fetchImpl: async url => {
      requestCount += 1;
      if (String(url).includes('frankfurter')) return new Response(JSON.stringify({}));
      return new Response(JSON.stringify({ rates: { CNY: 7.2345 } }));
    },
  });

  try {
    const snapshot = await module.refreshUsdToCnyRate(true);

    assert.equal(requestCount, 2);
    assert.equal(snapshot.rate, 7.2345);
    assert.equal(snapshot.source, 'exchange-rate-api');
  } finally {
    cleanupExchangeRateTestEnvironment();
  }
});

test('keeps fallback rate when all online providers fail', async () => {
  const { module } = installExchangeRateTestEnvironment({
    fetchImpl: async () => {
      throw new Error('network unavailable');
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const snapshot = await module.refreshUsdToCnyRate(true);

    assert.equal(snapshot.rate, 6.8032);
    assert.equal(snapshot.source, 'fallback');
    assert.equal(module.getUsdToCnyRate(), 6.8032);
  } finally {
    console.warn = originalWarn;
    cleanupExchangeRateTestEnvironment();
  }
});

let originalFetch;
let originalLocalStorage;
let originalWindow;
let originalCustomEvent;

function installExchangeRateTestEnvironment(options = {}) {
  const storage = new Map();
  const events = [];

  originalFetch = globalThis.fetch;
  originalLocalStorage = globalThis.localStorage;
  originalWindow = globalThis.window;
  originalCustomEvent = globalThis.CustomEvent;

  globalThis.fetch =
    options.fetchImpl ??
    (async () => {
      throw new Error('fetch should not be called');
    });
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
    removeItem: key => {
      storage.delete(key);
    },
    clear: () => storage.clear(),
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.window = {
    dispatchEvent: event => {
      events.push(event);
      return true;
    },
  };

  delete require.cache[require.resolve('./exchange-rate.ts')];
  return {
    module: require('./exchange-rate.ts'),
    storage,
    events,
  };
}

function cleanupExchangeRateTestEnvironment() {
  if (originalFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = originalFetch;

  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;

  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;

  if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = originalCustomEvent;

  originalFetch = undefined;
  originalLocalStorage = undefined;
  originalWindow = undefined;
  originalCustomEvent = undefined;
  delete require.cache[require.resolve('./exchange-rate.ts')];
}
