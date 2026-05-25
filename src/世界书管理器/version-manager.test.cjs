const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const {
  compareVersionTags,
  createScriptImportUrl,
  fetchVersionCatalog,
  inspectCurrentScriptVersion,
  replaceCurrentScriptVersion,
  sortStableVersionTags,
  validateVersionImportTemplate,
  versionRelation,
} = require('./version-manager.ts');

test('filters stable tags, deduplicates comparable versions, sorts descending, and limits results', () => {
  const tags = sortStableVersionTags(['v2.9', 'main', 'v3.00', 'v3.1', 'v3.0-beta', 'v1.2.3', 'v3.01'], 3);

  assert.deepEqual(tags, ['v3.1', 'v3.00', 'v2.9']);
});

test('compares version tags and classifies relation to current version', () => {
  assert.equal(compareVersionTags('v3.01', 'v3.0'), 1);
  assert.equal(compareVersionTags('v3.00', 'v3.0'), 0);
  assert.equal(versionRelation('v2.32', 'v3.00'), 'older');
  assert.equal(versionRelation('v3.1', 'v3.00'), 'newer');
});

test('uses latest release and falls back to sorted tag list', async () => {
  const requested = [];
  const catalog = await fetchVersionCatalog({
    currentVersion: 'v3.00',
    fetcher: async url => {
      requested.push(url);
      if (url.endsWith('/releases/latest')) return jsonResponse({ tag_name: 'v3.02' });
      return jsonResponse([{ name: 'v2.32' }, { name: 'v3.01' }, { name: 'draft' }]);
    },
  });

  assert.equal(catalog.latestVersion, 'v3.02');
  assert.deepEqual(catalog.versions, ['v3.02', 'v3.01', 'v2.32']);
  assert.equal(catalog.errorMessage, null);
  assert.ok(requested.some(url => url.includes('/releases/latest')));
  assert.ok(requested.some(url => url.includes('/tags?per_page=20')));
});

test('uses jsDelivr data API before GitHub API when listing versions', async () => {
  const requested = [];
  const catalog = await fetchVersionCatalog({
    currentVersion: 'v3.00',
    fetcher: async url => {
      requested.push(url);
      if (url.includes('data.jsdelivr.com')) return jsonResponse({ versions: ['3.16', '3.15', '3.13', 'draft'] });
      throw new Error(`unexpected request: ${url}`);
    },
  });

  assert.equal(catalog.latestVersion, 'v3.16');
  assert.deepEqual(catalog.versions, ['v3.16', 'v3.15', 'v3.13']);
  assert.equal(catalog.errorMessage, null);
  assert.ok(requested.some(url => url.includes('data.jsdelivr.com')));
  assert.ok(!requested.some(url => url.includes('api.github.com')));
});

test('falls back to tags when latest release does not exist', async () => {
  const catalog = await fetchVersionCatalog({
    currentVersion: 'v3.00',
    fetcher: async url => {
      if (url.endsWith('/releases/latest')) return jsonResponse({ message: 'Not Found' }, { status: 404 });
      return jsonResponse([{ name: 'v2.32' }, { name: 'v3.05' }]);
    },
  });

  assert.equal(catalog.latestVersion, 'v3.05');
  assert.deepEqual(catalog.versions, ['v3.05', 'v2.32']);
});

test('inspects the current script import source across nested script trees', () => {
  const api = createScriptApi({
    global: [{ type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v2.32') })] }],
  });

  const source = inspectCurrentScriptVersion(api);

  assert.equal(source.status, 'versioned');
  assert.equal(source.scope, 'global');
  assert.equal(source.scriptName, '世界书缓存优化器');
  assert.equal(source.specifier, 'v2.32');
  assert.equal(source.importTemplate, importTemplate('cdn.jsdelivr.net'));
});

test('updates a standard fixed-tag import to the selected tag', async () => {
  const api = createScriptApi({
    preset: [{ type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v2.32') })] }],
  });

  const result = await replaceCurrentScriptVersion('v3.00', {}, api);

  assert.equal(result.ok, true);
  assert.equal(result.previousSpecifier, 'v2.32');
  assert.equal(result.targetImportUrl, createScriptImportUrl('v3.00'));
  assert.equal(api.trees.preset[0].scripts[0].content, importContent('v3.00'));
});

test('can switch a fixed-tag import to a selected distribution source', async () => {
  const api = createScriptApi({
    preset: [{ type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v2.32') })] }],
  });

  const fastlyTemplate = importTemplate('fastly.jsdelivr.net');
  const result = await replaceCurrentScriptVersion('v3.00', { importTemplate: fastlyTemplate }, api);

  assert.equal(result.ok, true);
  assert.equal(result.targetImportUrl, createScriptImportUrl('v3.00', fastlyTemplate));
  assert.equal(api.trees.preset[0].scripts[0].content, importContent('v3.00', fastlyTemplate));
});

test('can lock a main import to a selected fixed tag for rollback or reproducibility', async () => {
  const api = createScriptApi({
    character: [script({ id: 'target', content: importContent('main') })],
  });

  const result = await replaceCurrentScriptVersion('v2.32', {}, api);

  assert.equal(result.ok, true);
  assert.equal(result.previousSpecifier, 'main');
  assert.equal(api.trees.character[0].content, importContent('v2.32'));
});

test('updates only the current script id when other scripts share the same name or content', async () => {
  const api = createScriptApi({
    global: [
      script({ id: 'target', content: importContent('v2.32') }),
      script({ id: 'same-name', content: importContent('v2.32') }),
      script({ id: 'same-content-disabled', content: importContent('v2.32'), enabled: false }),
    ],
  });

  const result = await replaceCurrentScriptVersion('v3.00', {}, api);

  assert.equal(result.ok, true);
  assert.equal(api.trees.global[0].content, importContent('v3.00'));
  assert.equal(api.trees.global[1].content, importContent('v2.32'));
  assert.equal(api.trees.global[2].content, importContent('v2.32'));
});

test('refuses automatic writes when the current script id appears more than once', async () => {
  const api = createScriptApi({
    global: [
      script({ id: 'target', content: importContent('v2.32') }),
      { type: 'folder', id: 'folder', scripts: [script({ id: 'target', content: importContent('v2.31') })] },
    ],
  });

  const result = await replaceCurrentScriptVersion('v3.00', {}, api);

  assert.equal(result.ok, false);
  assert.equal(result.source.status, 'ambiguous');
  assert.equal(api.trees.global[0].content, importContent('v2.32'));
  assert.equal(api.trees.global[1].scripts[0].content, importContent('v2.31'));
});

test('recognizes raw GitHub imports and validates custom mirror templates', async () => {
  const rawTemplate =
    'https://raw.githubusercontent.com/jerryzmtz/worldbook-manager/{version}/dist/世界书管理器/index.js';
  const mirrorTemplate =
    'https://mirror.example.com/gh/jerryzmtz/worldbook-manager@{version}/dist/世界书管理器/index.js';
  const api = createScriptApi({
    global: [script({ id: 'target', content: importContent('v3.00', rawTemplate) })],
  });

  const source = inspectCurrentScriptVersion(api);
  assert.equal(source.status, 'versioned');
  assert.equal(source.importTemplate, rawTemplate);
  assert.equal(validateVersionImportTemplate(mirrorTemplate).ok, true);
  assert.equal(validateVersionImportTemplate('https://example.com/no-version.js').ok, false);
  assert.equal(
    validateVersionImportTemplate("https://mirror.example.com/gh/jerryzmtz/worldbook-manager@{version}/dist/世界书管理器/index.js'").ok,
    false,
  );
});

test('refuses non-standard or ambiguous script content and returns copyable fallback information', async () => {
  const api = createScriptApi({
    global: [script({ id: 'target', content: 'console.log("hello")' })],
  });

  const result = await replaceCurrentScriptVersion('v3.00', {}, api);

  assert.equal(result.ok, false);
  assert.equal(result.targetImportUrl, createScriptImportUrl('v3.00'));
  assert.equal(result.source.status, 'no_import');
});

function importContent(version, template = importTemplate('cdn.jsdelivr.net')) {
  return `import '${template.replace('{version}', version)}'`;
}

function importTemplate(host) {
  return `https://${host}/gh/jerryzmtz/worldbook-manager@{version}/dist/世界书管理器/index.js`;
}

function script(overrides) {
  return {
    type: 'script',
    enabled: overrides.enabled ?? true,
    name: '世界书缓存优化器',
    id: overrides.id,
    content: overrides.content,
    info: '',
    button: { enabled: true, buttons: [] },
    data: {},
  };
}

function createScriptApi(trees) {
  const api = {
    trees: {
      global: trees.global ?? [],
      preset: trees.preset ?? [],
      character: trees.character ?? [],
    },
    getScriptId: () => 'target',
    getScriptTrees: ({ type }) => api.trees[type],
    updateScriptTreesWith: (updater, { type }) => {
      api.trees[type] = updater(api.trees[type]);
      return api.trees[type];
    },
  };
  return api;
}

function jsonResponse(payload, options = {}) {
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status ?? 200,
    json: async () => payload,
  };
}
