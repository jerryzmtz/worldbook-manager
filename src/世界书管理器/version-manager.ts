import { compareVersions } from 'compare-versions';

export type VersionRelation = 'current' | 'newer' | 'older';
export type ScriptScope = 'global' | 'preset' | 'character';
export type VersionImportSourceId = 'jsdelivr' | 'fastly' | 'gcore' | 'testingcf' | 'github_raw';

export type VersionImportSource = {
  id: VersionImportSourceId;
  label: string;
  description: string;
  template: string;
};

export type VersionCatalog = {
  latestVersion: string | null;
  versions: string[];
  checkedAt: number;
  errorMessage: string | null;
};

export type ScriptVersionSource =
  | {
      status: 'versioned' | 'main';
      scriptId: string;
      scriptName: string;
      scope: ScriptScope;
      specifier: string;
      importUrl: string;
      importTemplate: string;
    }
  | {
      status: 'api_unavailable' | 'not_found' | 'ambiguous' | 'no_import' | 'unsupported' | 'error';
      message: string;
      scriptId?: string;
      scriptName?: string;
      scope?: ScriptScope;
      specifier?: string;
      importUrl?: string;
      importTemplate?: string;
    };

export type ScriptVersionUpdateResult =
  | {
      ok: true;
      targetVersion: string;
      targetImportUrl: string;
      previousSpecifier: string;
      scriptName: string;
      scope: ScriptScope;
    }
  | {
      ok: false;
      targetVersion: string;
      targetImportUrl: string;
      reason: string;
      source: ScriptVersionSource;
    };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type ScriptNode = {
  type: 'script' | 'folder';
  id?: string;
  name?: string;
  content?: string;
  scripts?: ScriptNode[];
  [key: string]: unknown;
};

type ScriptApi = {
  getScriptId?: () => string;
  getScriptTrees?: (option: { type: ScriptScope }) => ScriptNode[];
  updateScriptTreesWith?: (
    updater: (scriptTrees: ScriptNode[]) => ScriptNode[],
    option: { type: ScriptScope },
  ) => ScriptNode[] | Promise<ScriptNode[]>;
};

type FoundScript = {
  script: ScriptNode;
  scope: ScriptScope;
};

type ImportParseResult =
  | { status: 'versioned' | 'main'; specifier: string; importUrl: string; importTemplate: string }
  | { status: 'no_import' | 'ambiguous' | 'unsupported'; specifier?: string; importUrl?: string; importTemplate?: string };

export type VersionImportTemplateValidation =
  | { ok: true; template: string }
  | { ok: false; message: string; template: string };

const GITHUB_API_BASE = 'https://api.github.com/repos/jerryzmtz/worldbook-manager';
const JSDELIVR_DATA_API_BASE = 'https://data.jsdelivr.com/v1/package/gh/jerryzmtz/worldbook-manager';
const VERSION_TAG_PATTERN = /^v\d+(?:\.\d+)+$/;
const SCRIPT_SCOPES: ScriptScope[] = ['global', 'preset', 'character'];
const VERSION_PLACEHOLDER = '{version}';
const WORLDBOOK_MANAGER_FILE_PATH = '/dist/世界书管理器/index.js';
const WORLDBOOK_MANAGER_IMPORT_URL_PATTERN = /https:\/\/[^\s'")]+\/dist\/世界书管理器\/index\.js(?:\?[^\s'")]*)?/g;
const JSDELIVR_REPO_MARKER = 'jerryzmtz/worldbook-manager@';
const RAW_REPO_MARKER = 'jerryzmtz/worldbook-manager/';
export const CUSTOM_VERSION_IMPORT_SOURCE_ID = 'custom';
export const VERSION_IMPORT_SOURCES: VersionImportSource[] = [
  {
    id: 'jsdelivr',
    label: 'jsDelivr 默认',
    description: '海外和一般网络优先。中国境内如果打不开或缓存异常，建议先换 Fastly 或 GCore。',
    template: `https://cdn.jsdelivr.net/gh/jerryzmtz/worldbook-manager@${VERSION_PLACEHOLDER}/dist/世界书管理器/index.js`,
  },
  {
    id: 'fastly',
    label: 'Fastly，国内优先尝试',
    description: '中国境内用户优先尝试的备用入口。适合 cdn.jsdelivr.net 被污染、解析慢或缓存不刷新时切换。',
    template: `https://fastly.jsdelivr.net/gh/jerryzmtz/worldbook-manager@${VERSION_PLACEHOLDER}/dist/世界书管理器/index.js`,
  },
  {
    id: 'gcore',
    label: 'GCore，国内备用',
    description: '中国境内第二备用入口。不同运营商表现会变，Fastly 不通或很慢时可以试这个。',
    template: `https://gcore.jsdelivr.net/gh/jerryzmtz/worldbook-manager@${VERSION_PLACEHOLDER}/dist/世界书管理器/index.js`,
  },
  {
    id: 'testingcf',
    label: 'Cloudflare 测试域',
    description: '适合排查默认域缓存或解析问题。中国境内不一定稳定，Fastly 和 GCore 都不合适时再试。',
    template: `https://testingcf.jsdelivr.net/gh/jerryzmtz/worldbook-manager@${VERSION_PLACEHOLDER}/dist/世界书管理器/index.js`,
  },
  {
    id: 'github_raw',
    label: 'GitHub Raw',
    description: '直接读取 GitHub 原始文件。中国境内通常不推荐直连，主要用于 VPN/代理环境或 CDN 缓存排查。',
    template: `https://raw.githubusercontent.com/jerryzmtz/worldbook-manager/${VERSION_PLACEHOLDER}/dist/世界书管理器/index.js`,
  },
];
export const DEFAULT_VERSION_IMPORT_TEMPLATE = VERSION_IMPORT_SOURCES[0].template;

export function createScriptImportUrl(version: string, importTemplate = DEFAULT_VERSION_IMPORT_TEMPLATE): string {
  return normalizeImportTemplate(importTemplate).replaceAll(VERSION_PLACEHOLDER, version);
}

export function validateVersionImportTemplate(template: unknown): VersionImportTemplateValidation {
  if (typeof template !== 'string') {
    return { ok: false, message: '分发源模板必须是文本。', template: '' };
  }
  const normalized = normalizeImportTemplate(template);
  if (!normalized.startsWith('https://')) {
    return { ok: false, message: '分发源模板必须使用 https。', template: normalized };
  }
  if (/[\s'")]/.test(normalized)) {
    return { ok: false, message: '分发源模板不能包含空格或引号。', template: normalized };
  }
  if (!normalized.includes(VERSION_PLACEHOLDER)) {
    return { ok: false, message: '分发源模板需要包含 {version} 占位符。', template: normalized };
  }
  const sampleUrl = createScriptImportUrl('v1.2.3', normalized);
  const parsed = parseWorldbookManagerImport(sampleUrl);
  if (parsed.status !== 'versioned') {
    return {
      ok: false,
      message: '分发源模板必须指向 jerryzmtz/worldbook-manager 的 index.js 文件。',
      template: normalized,
    };
  }
  return { ok: true, template: normalized };
}

export function getKnownVersionImportSourceByTemplate(template: string): VersionImportSource | null {
  const normalized = normalizeImportTemplate(template);
  return VERSION_IMPORT_SOURCES.find(source => source.template === normalized) ?? null;
}

export function normalizeVersionTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim();
  if (!VERSION_TAG_PATTERN.test(tag)) return null;
  return tag;
}

export function toComparableVersion(tag: string): string {
  const normalized = normalizeVersionTag(tag);
  if (!normalized) return '0.0.0';
  return normalized
    .slice(1)
    .split('.')
    .map(part => String(Number(part)))
    .join('.');
}

export function compareVersionTags(left: string, right: string): number {
  return compareVersions(toComparableVersion(left), toComparableVersion(right));
}

export function versionRelation(version: string, currentVersion: string): VersionRelation {
  const order = compareVersionTags(version, currentVersion);
  if (order === 0) return 'current';
  return order > 0 ? 'newer' : 'older';
}

export function sortStableVersionTags(tags: unknown[], limit = 20): string[] {
  const seen = new Set<string>();
  const stableTags: string[] = [];
  for (const tag of tags.map(normalizeVersionTag)) {
    if (!tag) continue;
    const comparable = toComparableVersion(tag);
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    stableTags.push(tag);
  }

  return stableTags
    .sort((left, right) => compareVersionTags(right, left))
    .slice(0, limit);
}

export async function fetchVersionCatalog(options: {
  currentVersion: string;
  fetcher?: FetchLike;
  limit?: number;
}): Promise<VersionCatalog> {
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  const limit = options.limit ?? 20;
  if (!fetcher) {
    return {
      latestVersion: null,
      versions: [],
      checkedAt: Date.now(),
      errorMessage: '当前环境无法发起网络请求。',
    };
  }

  const errors: string[] = [];
  let versions = await fetchJsDelivrVersions(fetcher, limit).catch(error => {
    errors.push(normalizeFetchError(error, '无法读取 jsDelivr 版本列表。'));
    return [];
  });
  let latestFromRelease: string | null = versions[0] ?? null;

  if (versions.length === 0) {
    latestFromRelease = await fetchLatestReleaseVersion(fetcher).catch(error => {
      errors.push(normalizeFetchError(error, '无法读取最新发布版本。'));
      return null;
    });
    versions = await fetchRepositoryTags(fetcher, limit).catch(error => {
      errors.push(normalizeFetchError(error, '无法读取版本列表。'));
      return [];
    });
  }

  const mergedVersions = sortStableVersionTags([...versions, latestFromRelease].filter(Boolean), limit);
  const latestVersion = latestFromRelease ?? mergedVersions[0] ?? null;

  return {
    latestVersion,
    versions: mergedVersions,
    checkedAt: Date.now(),
    errorMessage: latestVersion || mergedVersions.length ? null : errors[0] ?? '没有找到可用版本。',
  };
}

export function inspectCurrentScriptVersion(api: ScriptApi = globalThis as unknown as ScriptApi): ScriptVersionSource {
  if (!api.getScriptId || !api.getScriptTrees) {
    return { status: 'api_unavailable', message: '当前酒馆助手脚本 API 不可用。' };
  }

  let scriptId = '';
  try {
    scriptId = api.getScriptId();
  } catch (error) {
    return { status: 'error', message: normalizeUnknownError(error, '无法读取当前脚本 ID。') };
  }
  if (!scriptId) {
    return { status: 'api_unavailable', message: '当前脚本 ID 不可用。' };
  }

  const foundScripts: FoundScript[] = [];
  for (const scope of SCRIPT_SCOPES) {
    try {
      foundScripts.push(...findScriptsById(api.getScriptTrees({ type: scope }), scriptId).map(script => ({ script, scope })));
    } catch {
      // Some scopes can be unavailable depending on where the script is installed.
    }
  }

  if (foundScripts.length === 0) {
    return { status: 'not_found', scriptId, message: '没有在酒馆助手脚本列表中找到当前脚本。' };
  }
  if (foundScripts.length > 1) {
    return { status: 'ambiguous', scriptId, message: '多个位置都找到了当前脚本，无法安全自动修改。' };
  }

  const [{ script, scope }] = foundScripts;
  const scriptName = typeof script.name === 'string' && script.name ? script.name : '未命名脚本';
  const parsed = parseWorldbookManagerImport(script.content);

  if (parsed.status === 'versioned' || parsed.status === 'main') {
    return {
      status: parsed.status,
      scriptId,
      scriptName,
      scope,
      specifier: parsed.specifier,
      importUrl: parsed.importUrl,
      importTemplate: parsed.importTemplate,
    };
  }

  return {
    status: parsed.status,
    scriptId,
    scriptName,
    scope,
    specifier: parsed.specifier,
    importUrl: parsed.importUrl,
    importTemplate: parsed.importTemplate,
    message: sourceStatusMessage(parsed.status),
  };
}

export async function replaceCurrentScriptVersion(
  targetVersion: string,
  options: { importTemplate?: string } = {},
  api: ScriptApi = globalThis as unknown as ScriptApi,
): Promise<ScriptVersionUpdateResult> {
  const normalizedTarget = normalizeVersionTag(targetVersion);
  const templateValidation = validateVersionImportTemplate(options.importTemplate ?? DEFAULT_VERSION_IMPORT_TEMPLATE);
  const targetImportUrl = templateValidation.ok
    ? createScriptImportUrl(normalizedTarget ?? targetVersion, templateValidation.template)
    : createScriptImportUrl(normalizedTarget ?? targetVersion);
  const source = inspectCurrentScriptVersion(api);

  if (!normalizedTarget) {
    return {
      ok: false,
      targetVersion,
      targetImportUrl,
      reason: '目标版本不是稳定版本 tag。',
      source,
    };
  }

  if (!templateValidation.ok) {
    return {
      ok: false,
      targetVersion: normalizedTarget,
      targetImportUrl,
      reason: templateValidation.message,
      source,
    };
  }

  if (!api.updateScriptTreesWith || !api.getScriptId) {
    return {
      ok: false,
      targetVersion: normalizedTarget,
      targetImportUrl,
      reason: '当前酒馆助手脚本写入 API 不可用。',
      source,
    };
  }

  if (source.status !== 'versioned' && source.status !== 'main') {
    return {
      ok: false,
      targetVersion: normalizedTarget,
      targetImportUrl,
      reason: source.message,
      source,
    };
  }

  let changed = false;
  await Promise.resolve(
    api.updateScriptTreesWith(scriptTrees => {
      const result = replaceScriptImportInTree(scriptTrees, source.scriptId, targetImportUrl);
      changed = result.changed;
      return result.trees;
    }, { type: source.scope }),
  );

  if (!changed) {
    return {
      ok: false,
      targetVersion: normalizedTarget,
      targetImportUrl,
      reason: '脚本内容在确认后发生变化，自动修改已取消。',
      source,
    };
  }

  return {
    ok: true,
    targetVersion: normalizedTarget,
    targetImportUrl,
    previousSpecifier: source.specifier,
    scriptName: source.scriptName,
    scope: source.scope,
  };
}

function parseWorldbookManagerImport(content: unknown): ImportParseResult {
  if (typeof content !== 'string') return { status: 'no_import' };
  const parsedImports = Array.from(content.matchAll(WORLDBOOK_MANAGER_IMPORT_URL_PATTERN))
    .map(match => parseImportUrl(match[0]))
    .filter((parsed): parsed is Extract<ImportParseResult, { importUrl: string }> => parsed.status !== 'no_import');
  if (parsedImports.length === 0) return { status: 'no_import' };
  if (parsedImports.length > 1) return { status: 'ambiguous' };

  const [{ specifier, importUrl, importTemplate }] = parsedImports;
  if (!specifier) return { status: 'unsupported', importUrl, importTemplate };
  if (specifier === 'main') return { status: 'main', specifier, importUrl };
  const normalized = normalizeVersionTag(specifier);
  if (normalized) return { status: 'versioned', specifier: normalized, importUrl, importTemplate };
  return { status: 'unsupported', specifier, importUrl, importTemplate };
}

function replaceScriptImportInTree(
  scriptTrees: ScriptNode[],
  scriptId: string,
  targetImportUrl: string,
): { trees: ScriptNode[]; changed: boolean } {
  let changed = false;
  const trees = scriptTrees.map(node => mapScriptNode(node, scriptId, targetImportUrl, () => {
    changed = true;
  }));
  return { trees, changed };
}

function mapScriptNode(node: ScriptNode, scriptId: string, targetImportUrl: string, onChange: () => void): ScriptNode {
  if (node.type === 'script' && node.id === scriptId) {
    const parsed = parseWorldbookManagerImport(node.content);
    if (parsed.status !== 'versioned' && parsed.status !== 'main') return node;
    const nextContent = String(node.content).replace(parsed.importUrl, targetImportUrl);
    if (nextContent === node.content) return node;
    onChange();
    return { ...node, content: nextContent };
  }

  if (node.type === 'folder' && Array.isArray(node.scripts)) {
    return { ...node, scripts: node.scripts.map(child => mapScriptNode(child, scriptId, targetImportUrl, onChange)) };
  }

  return node;
}

function parseImportUrl(importUrl: string): ImportParseResult {
  const fileIndex = importUrl.indexOf(WORLDBOOK_MANAGER_FILE_PATH);
  if (fileIndex < 0) return { status: 'no_import' };
  const beforeFilePath = importUrl.slice(0, fileIndex);
  const jsDelivrMarkerIndex = beforeFilePath.lastIndexOf(JSDELIVR_REPO_MARKER);
  if (jsDelivrMarkerIndex >= 0) {
    return createImportParseResult(importUrl, jsDelivrMarkerIndex + JSDELIVR_REPO_MARKER.length, fileIndex);
  }

  const rawMarkerIndex = beforeFilePath.lastIndexOf(RAW_REPO_MARKER);
  if (rawMarkerIndex >= 0) {
    return createImportParseResult(importUrl, rawMarkerIndex + RAW_REPO_MARKER.length, fileIndex);
  }

  return { status: 'no_import' };
}

function createImportParseResult(importUrl: string, specifierStart: number, specifierEnd: number): ImportParseResult {
  const specifier = importUrl.slice(specifierStart, specifierEnd);
  const importTemplate = `${importUrl.slice(0, specifierStart)}${VERSION_PLACEHOLDER}${importUrl.slice(specifierEnd)}`;
  if (!specifier) return { status: 'unsupported', importUrl, importTemplate };
  return { status: 'versioned', specifier, importUrl, importTemplate };
}

function normalizeImportTemplate(template: string): string {
  return template.trim();
}

function findScriptsById(scriptTrees: ScriptNode[], scriptId: string): ScriptNode[] {
  const scripts: ScriptNode[] = [];
  for (const node of scriptTrees) {
    if (node.type === 'script' && node.id === scriptId) scripts.push(node);
    if (node.type === 'folder' && Array.isArray(node.scripts)) {
      scripts.push(...findScriptsById(node.scripts, scriptId));
    }
  }
  return scripts;
}

async function fetchLatestReleaseVersion(fetcher: FetchLike): Promise<string | null> {
  const response = await fetcher(`${GITHUB_API_BASE}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub release API 返回 ${response.status}`);
  const payload = (await response.json()) as { tag_name?: unknown };
  return normalizeVersionTag(payload.tag_name);
}

async function fetchJsDelivrVersions(fetcher: FetchLike, limit: number): Promise<string[]> {
  const response = await fetcher(JSDELIVR_DATA_API_BASE, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`jsDelivr data API 返回 ${response.status}`);
  const payload = (await response.json()) as { versions?: unknown };
  if (!Array.isArray(payload.versions)) throw new Error('jsDelivr data API 未返回版本列表');
  return sortStableVersionTags(payload.versions.map(normalizeJsDelivrVersionTag), limit);
}

async function fetchRepositoryTags(fetcher: FetchLike, limit: number): Promise<string[]> {
  const response = await fetcher(`${GITHUB_API_BASE}/tags?per_page=${Math.max(20, limit)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub tags API 返回 ${response.status}`);
  const payload = (await response.json()) as Array<{ name?: unknown }>;
  return sortStableVersionTags(payload.map(tag => tag.name), limit);
}

function normalizeJsDelivrVersionTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return normalizeVersionTag(version) ?? normalizeVersionTag(`v${version}`);
}

function sourceStatusMessage(status: ImportParseResult['status']): string {
  if (status === 'ambiguous') return '脚本中包含多个世界书管理器 import，无法安全自动修改。';
  if (status === 'unsupported') return '脚本使用的世界书管理器版本格式不支持自动修改。';
  return '当前脚本不是标准的世界书管理器 jsDelivr import。';
}

function normalizeFetchError(error: unknown, fallback: string): string {
  return normalizeUnknownError(error, fallback);
}

function normalizeUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
