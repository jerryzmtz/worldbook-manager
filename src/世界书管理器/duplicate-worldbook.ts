export type DuplicateWorldbookSource = 'global' | 'character_primary' | 'character_additional' | 'chat';

export type WorldbookNameVersionKind = 'semantic' | 'full_date' | 'month_day' | 'numeric' | 'copy' | 'none';

export type WorldbookNameVersionInfo = {
  originalName: string;
  cleanName: string;
  familyName: string;
  normalizedFamilyName: string;
  versionLabel: string | null;
  versionKind: WorldbookNameVersionKind;
  versionScore: number | null;
  versionRank: number;
  isCopy: boolean;
  copyIndex: number | null;
  removedTokens: string[];
};

export type DuplicateWorldbookEntrySnapshot = {
  uid?: unknown;
  name?: unknown;
  enabled?: unknown;
  strategy?: {
    type?: unknown;
    keys?: unknown;
    keys_secondary?: { logic?: unknown; keys?: unknown };
    scan_depth?: unknown;
  };
  position?: {
    type?: unknown;
    role?: unknown;
    depth?: unknown;
    order?: unknown;
  };
  content?: unknown;
  probability?: unknown;
  recursion?: {
    prevent_incoming?: unknown;
    prevent_outgoing?: unknown;
    delay_until?: unknown;
  };
  effect?: {
    sticky?: unknown;
    cooldown?: unknown;
    delay?: unknown;
  };
};

export type DuplicateWorldbookContentFingerprint = {
  entryCount: number;
  enabledEntryCount: number;
  tokenEstimate: number;
  contentHash: string;
  enabledContentHash: string;
  entryHashes: string[];
  enabledEntryHashes: string[];
  contentLength: number;
};

export type DuplicateWorldbookSnapshot = {
  name: string;
  entries: DuplicateWorldbookEntrySnapshot[];
  importedAt?: number | null;
  modifiedAt?: number | null;
  loadedAt?: number | null;
};

export type DuplicateWorldbookCandidate = {
  name: string;
  versionInfo: WorldbookNameVersionInfo;
  fingerprint: DuplicateWorldbookContentFingerprint;
  sources: DuplicateWorldbookSource[];
  importedAt: number | null;
  modifiedAt: number | null;
  loadedAt: number | null;
  similarityToKeep: number;
  coverageByKeep: number;
};

export type DuplicateWorldbookConfidence = 'exact' | 'high' | 'medium' | 'low';

export type DuplicateWorldbookGroup = {
  id: string;
  familyName: string;
  normalizedFamilyName: string;
  confidence: DuplicateWorldbookConfidence;
  defaultSelected: boolean;
  keepCandidate: DuplicateWorldbookCandidate;
  deleteCandidates: DuplicateWorldbookCandidate[];
  candidates: DuplicateWorldbookCandidate[];
  similarity: number;
  coverage: number;
  overlapCount: number;
  reason: string;
  warnings: string[];
};

export type DuplicateWorldbookPlan = {
  groups: DuplicateWorldbookGroup[];
  candidates: DuplicateWorldbookCandidate[];
  summary: {
    scannedBooks: number;
    duplicateGroups: number;
    defaultDeleteBooks: number;
    lowConfidenceGroups: number;
  };
};

export type DuplicateApplyResult = {
  groupId: string;
  keepName: string;
  worldbook: string;
  reboundSources: DuplicateWorldbookSource[];
  failed: boolean;
  errorMessage: string | null;
};

export type DuplicateWorldbookPlanOptions = {
  keepPriority?: 'latest_version';
  lowConfidenceSimilarity?: number;
  lowConfidenceCoverage?: number;
};

export type DuplicateWorldbookBindings = {
  globalNames?: string[];
  charWorldbooks?: {
    primary: string | null;
    additional: string[];
  };
  chatName?: string | null;
};

export type DuplicateWorldbookRebindPlan = {
  changed: boolean;
  sources: DuplicateWorldbookSource[];
  globalNames?: string[];
  charWorldbooks?: {
    primary: string | null;
    additional: string[];
  };
  chatName?: string | null;
};

type ParsedVersionToken = {
  label: string;
  kind: Exclude<WorldbookNameVersionKind, 'none' | 'copy'>;
  score: number;
  rank: number;
  token: string;
};

type ParsedCopyToken = {
  token: string;
  copyIndex: number | null;
};

type FingerprintComparison = {
  similarity: number;
  leftCoverage: number;
  rightCoverage: number;
  smallerCoverage: number;
  overlap: number;
  union: number;
  exact: boolean;
};

const VERSION_RANK: Record<Exclude<WorldbookNameVersionKind, 'none' | 'copy'>, number> = {
  full_date: 4,
  month_day: 3,
  semantic: 2,
  numeric: 1,
};
const DEFAULT_LOW_CONFIDENCE_SIMILARITY = 0.45;
const DEFAULT_LOW_CONFIDENCE_COVERAGE = 0.65;
const MEDIUM_SIMILARITY = 0.72;
const MEDIUM_COVERAGE = 0.8;
const HIGH_SIMILARITY = 0.92;
const HIGH_COVERAGE = 0.95;

export function parseWorldbookVersionName(name: string): WorldbookNameVersionInfo {
  const cleanName = cleanupBookName(stripWorldbookExtension(name));
  let familyName = cleanName;
  let bestVersion: ParsedVersionToken | null = null;
  let isCopy = false;
  let copyIndex: number | null = null;
  const removedTokens: string[] = [];

  for (let index = 0; index < 8; index += 1) {
    const before = familyName;
    const copyMatch = stripCopySuffix(familyName);
    if (copyMatch) {
      familyName = copyMatch.base;
      removedTokens.push(copyMatch.parsed.token);
      isCopy = true;
      copyIndex = copyMatch.parsed.copyIndex ?? copyIndex;
    }

    const versionMatch = stripVersionSuffix(familyName);
    if (versionMatch) {
      familyName = versionMatch.base;
      removedTokens.push(versionMatch.parsed.token);
      bestVersion = chooseBetterVersionToken(bestVersion, versionMatch.parsed);
    }

    familyName = trimNameBoundary(familyName);
    if (familyName === before) break;
  }

  if (!familyName) familyName = cleanName;
  const normalizedFamilyName = normalizeFamilyName(familyName);
  const versionKind: WorldbookNameVersionKind = bestVersion?.kind ?? (isCopy ? 'copy' : 'none');

  return {
    originalName: name,
    cleanName,
    familyName,
    normalizedFamilyName,
    versionLabel: bestVersion?.label ?? null,
    versionKind,
    versionScore: bestVersion?.score ?? null,
    versionRank: bestVersion?.rank ?? 0,
    isCopy,
    copyIndex,
    removedTokens,
  };
}

export function createWorldbookContentFingerprint(
  entries: DuplicateWorldbookEntrySnapshot[],
): DuplicateWorldbookContentFingerprint {
  const entrySignatures = entries.map(entry => canonicalEntrySignature(entry));
  const enabledEntrySignatures = entries
    .filter(entry => entry.enabled !== false)
    .map(entry => canonicalEntrySignature(entry));
  const entryHashes = entrySignatures.map(hashText);
  const enabledEntryHashes = enabledEntrySignatures.map(hashText);
  const contentLength = entries.reduce((sum, entry) => sum + normalizeText(toStringValue(entry.content)).length, 0);

  return {
    entryCount: entries.length,
    enabledEntryCount: enabledEntrySignatures.length,
    tokenEstimate: estimateTokenCount(entries.map(entry => toStringValue(entry.content)).join('\n')),
    contentHash: hashText(entryHashes.join('|')),
    enabledContentHash: hashText(enabledEntryHashes.join('|')),
    entryHashes,
    enabledEntryHashes,
    contentLength,
  };
}

export function createDuplicateWorldbookPlan(
  snapshots: DuplicateWorldbookSnapshot[],
  sources: Record<string, DuplicateWorldbookSource[]> = {},
  options: DuplicateWorldbookPlanOptions = {},
): DuplicateWorldbookPlan {
  const candidates = snapshots.map<DuplicateWorldbookCandidate>(snapshot => ({
    name: snapshot.name,
    versionInfo: parseWorldbookVersionName(snapshot.name),
    fingerprint: createWorldbookContentFingerprint(snapshot.entries),
    sources: sources[snapshot.name] ?? [],
    importedAt: snapshot.importedAt ?? null,
    modifiedAt: snapshot.modifiedAt ?? null,
    loadedAt: snapshot.loadedAt ?? null,
    similarityToKeep: 0,
    coverageByKeep: 0,
  }));

  const byFamily = new Map<string, DuplicateWorldbookCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.versionInfo.normalizedFamilyName) continue;
    const family = byFamily.get(candidate.versionInfo.normalizedFamilyName) ?? [];
    family.push(candidate);
    byFamily.set(candidate.versionInfo.normalizedFamilyName, family);
  }

  const groups: DuplicateWorldbookGroup[] = [];
  const lowConfidenceSimilarity = options.lowConfidenceSimilarity ?? DEFAULT_LOW_CONFIDENCE_SIMILARITY;
  const lowConfidenceCoverage = options.lowConfidenceCoverage ?? DEFAULT_LOW_CONFIDENCE_COVERAGE;

  for (const familyCandidates of byFamily.values()) {
    if (familyCandidates.length < 2) continue;
    const comparison = strongestFamilyComparison(familyCandidates);
    if (
      comparison.similarity < lowConfidenceSimilarity &&
      comparison.smallerCoverage < lowConfidenceCoverage &&
      !comparison.exact
    ) {
      continue;
    }

    const confidence = classifyConfidence(comparison);
    const keepCandidate = chooseKeepCandidate(familyCandidates);
    const candidatesWithKeepMetrics = familyCandidates.map(candidate => {
      const keepComparison = compareFingerprints(candidate.fingerprint, keepCandidate.fingerprint);
      return {
        ...candidate,
        similarityToKeep: candidate.name === keepCandidate.name ? 1 : keepComparison.similarity,
        coverageByKeep: candidate.name === keepCandidate.name ? 1 : keepComparison.leftCoverage,
      };
    });
    const keepWithMetrics =
      candidatesWithKeepMetrics.find(candidate => candidate.name === keepCandidate.name) ?? candidatesWithKeepMetrics[0];
    const deleteCandidates = candidatesWithKeepMetrics.filter(candidate => candidate.name !== keepWithMetrics.name);
    const familyName = shortestFamilyName(familyCandidates.map(candidate => candidate.versionInfo.familyName));

    groups.push({
      id: `duplicate:${familyCandidates[0].versionInfo.normalizedFamilyName}`,
      familyName,
      normalizedFamilyName: familyCandidates[0].versionInfo.normalizedFamilyName,
      confidence,
      defaultSelected: confidence !== 'low',
      keepCandidate: keepWithMetrics,
      deleteCandidates,
      candidates: sortCandidatesForDisplay(candidatesWithKeepMetrics),
      similarity: comparison.similarity,
      coverage: comparison.smallerCoverage,
      overlapCount: comparison.overlap,
      reason: formatDuplicateReason(confidence, comparison),
      warnings: createGroupWarnings(keepWithMetrics, deleteCandidates),
    });
  }

  groups.sort(compareDuplicateGroups);

  return {
    groups,
    candidates,
    summary: {
      scannedBooks: candidates.length,
      duplicateGroups: groups.length,
      defaultDeleteBooks: groups
        .filter(group => group.defaultSelected)
        .reduce((sum, group) => sum + group.deleteCandidates.length, 0),
      lowConfidenceGroups: groups.filter(group => group.confidence === 'low').length,
    },
  };
}

export function createDuplicateWorldbookRebindPlan(
  deleteNames: string[],
  keepName: string,
  bindings: DuplicateWorldbookBindings,
): DuplicateWorldbookRebindPlan {
  const deleted = new Set(deleteNames);
  const sources: DuplicateWorldbookSource[] = [];
  const result: DuplicateWorldbookRebindPlan = { changed: false, sources };

  if (bindings.globalNames) {
    const nextGlobal = replaceDeletedNames(bindings.globalNames, deleted, keepName);
    if (!sameStringArray(nextGlobal, bindings.globalNames)) {
      result.changed = true;
      sources.push('global');
      result.globalNames = nextGlobal;
    }
  }

  if (bindings.charWorldbooks) {
    const original = bindings.charWorldbooks;
    const nextPrimary = original.primary && deleted.has(original.primary) ? keepName : original.primary;
    let nextAdditional = replaceDeletedNames(original.additional, deleted, keepName);
    if (nextPrimary) nextAdditional = nextAdditional.filter(name => name !== nextPrimary);
    const changed = nextPrimary !== original.primary || !sameStringArray(nextAdditional, original.additional);
    if (changed) {
      result.changed = true;
      if (nextPrimary !== original.primary) sources.push('character_primary');
      if (!sameStringArray(nextAdditional, original.additional)) sources.push('character_additional');
      result.charWorldbooks = {
        primary: nextPrimary,
        additional: nextAdditional,
      };
    }
  }

  if (bindings.chatName !== undefined) {
    const nextChatName = bindings.chatName && deleted.has(bindings.chatName) ? keepName : bindings.chatName;
    if (nextChatName !== bindings.chatName) {
      result.changed = true;
      sources.push('chat');
      result.chatName = nextChatName;
    }
  }

  result.sources = uniqueSources(sources);
  return result;
}

function chooseBetterVersionToken(current: ParsedVersionToken | null, next: ParsedVersionToken): ParsedVersionToken {
  if (!current) return next;
  if (next.rank !== current.rank) return next.rank > current.rank ? next : current;
  return next.score >= current.score ? next : current;
}

function stripWorldbookExtension(name: string): string {
  return name.replace(/\.json$/i, '');
}

function cleanupBookName(name: string): string {
  return trimNameBoundary(name.normalize('NFKC').replace(/\u200B|\u200C|\u200D|\uFEFF/g, ''));
}

function trimNameBoundary(name: string): string {
  return name.replace(/^[\s._\-~【】[\]()（）{}]+|[\s._\-~【】[\]()（）{}]+$/g, '').trim();
}

function normalizeFamilyName(name: string): string {
  return cleanupBookName(name)
    .toLowerCase()
    .replace(/[\s._\-~【】[\]()（）{}《》<>「」『』"'“”‘’]+/g, '');
}

function stripTrailingClosers(name: string): string {
  return name.replace(/[\u3011\u005d\u007d\u0029\uFF09]+$/u, '');
}

function stripCopySuffix(name: string): { base: string; parsed: ParsedCopyToken } | null {
  const candidateName = stripTrailingClosers(name);
  const copyMatch = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)(副本|复制|拷贝|备份|backup|copy|duplicate)(?:\s*(\d{1,3}))?$/iu,
  );
  if (copyMatch) {
    return {
      base: trimNameBoundary(copyMatch[1]),
      parsed: {
        token: copyMatch[2],
        copyIndex: copyMatch[3] ? Number(copyMatch[3]) : null,
      },
    };
  }

  const bracketNumberMatch = name.match(/^(.*?)[\u3010\u005b\u007b\u0028\uFF08](\d{1,2})[\u3011\u005d\u007d\u0029\uFF09]$/u);
  if (!bracketNumberMatch) return null;
  return {
    base: trimNameBoundary(bracketNumberMatch[1]),
    parsed: {
      token: bracketNumberMatch[2],
      copyIndex: Number(bracketNumberMatch[2]),
    },
  };
}

function stripVersionSuffix(name: string): { base: string; parsed: ParsedVersionToken } | null {
  return (
    stripSemanticVersionSuffix(name) ??
    stripFullDateSuffix(name) ??
    stripMonthDaySuffix(name) ??
    stripNumericVersionSuffix(name)
  );
}

function stripSemanticVersionSuffix(name: string): { base: string; parsed: ParsedVersionToken } | null {
  const candidateName = stripTrailingClosers(name);
  const match = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)(?:v|ver|version|版本)\s*([0-9]+(?:\.[0-9]+){0,3})$/iu,
  );
  if (!match) return null;
  const label = `v${match[2]}`;
  return {
    base: trimNameBoundary(match[1]),
    parsed: {
      label,
      kind: 'semantic',
      score: semanticVersionScore(match[2]),
      rank: VERSION_RANK.semantic,
      token: match[2],
    },
  };
}

function stripFullDateSuffix(name: string): { base: string; parsed: ParsedVersionToken } | null {
  const candidateName = stripTrailingClosers(name);
  const fullYearMatch = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)(20\d{2})[-_.年]?(0?[1-9]|1[0-2])[-_.月]?(0?[1-9]|[12]\d|3[01])日?$/u,
  );
  const shortYearMatch = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)(\d{2})[-_.年](0?[1-9]|1[0-2])[-_.月]?(0?[1-9]|[12]\d|3[01])日?$/u,
  );
  const match = fullYearMatch ?? shortYearMatch;
  if (!match) return null;
  const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  return {
    base: trimNameBoundary(match[1]),
    parsed: {
      label: `${year}-${pad2(month)}-${pad2(day)}`,
      kind: 'full_date',
      score: year * 10000 + month * 100 + day,
      rank: VERSION_RANK.full_date,
      token: match[2],
    },
  };
}

function stripMonthDaySuffix(name: string): { base: string; parsed: ParsedVersionToken } | null {
  const candidateName = stripTrailingClosers(name);
  const separated = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)((0?[1-9]|1[0-2])[-_.月]([0-2]?\d|3[01])日?)$/u,
  );
  const compact = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)((0[1-9]|1[0-2])([0-2]\d|3[01]))$/u,
  );
  const match = separated ?? compact;
  if (!match) return null;
  const month = Number(match[3]);
  const day = Number(match[4]);
  return {
    base: trimNameBoundary(match[1]),
    parsed: {
      label: `${pad2(month)}${pad2(day)}`,
      kind: 'month_day',
      score: month * 100 + day,
      rank: VERSION_RANK.month_day,
      token: match[2],
    },
  };
}

function stripNumericVersionSuffix(name: string): { base: string; parsed: ParsedVersionToken } | null {
  const candidateName = stripTrailingClosers(name);
  const match = candidateName.match(
    /^(.*?)(?:[\s._\-~]+|[\u3010\u005b\u007b\u0028\uFF08]+)(?:第)?(\d{1,3})(?:版|版本)?$/u,
  );
  if (!match) return null;
  return {
    base: trimNameBoundary(match[1]),
    parsed: {
      label: match[2],
      kind: 'numeric',
      score: Number(match[2]),
      rank: VERSION_RANK.numeric,
      token: match[2],
    },
  };
}

function semanticVersionScore(version: string): number {
  return version
    .split('.')
    .slice(0, 4)
    .reduce((score, part, index) => score + Number(part) * Math.pow(1000, 3 - index), 0);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function canonicalEntrySignature(entry: DuplicateWorldbookEntrySnapshot): string {
  return JSON.stringify({
    name: normalizeText(toStringValue(entry.name)),
    enabled: entry.enabled !== false,
    strategy: {
      type: toStringValue(entry.strategy?.type),
      keys: normalizeUnknownArray(entry.strategy?.keys),
      secondaryLogic: toStringValue(entry.strategy?.keys_secondary?.logic),
      secondaryKeys: normalizeUnknownArray(entry.strategy?.keys_secondary?.keys),
      scanDepth: toStringValue(entry.strategy?.scan_depth),
    },
    position: {
      type: toStringValue(entry.position?.type),
      role: toStringValue(entry.position?.role),
      depth: toNumberValue(entry.position?.depth),
      order: toNumberValue(entry.position?.order),
    },
    content: normalizeText(toStringValue(entry.content)),
    probability: toNumberValue(entry.probability),
    recursion: {
      preventIncoming: entry.recursion?.prevent_incoming === true,
      preventOutgoing: entry.recursion?.prevent_outgoing === true,
      delayUntil: entry.recursion?.delay_until ?? null,
    },
    effect: {
      sticky: entry.effect?.sticky ?? null,
      cooldown: entry.effect?.cooldown ?? null,
      delay: entry.effect?.delay ?? null,
    },
  });
}

function normalizeUnknownArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizeText(toStringValue(item)));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .join('\n')
    .trim();
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof RegExp) return String(value);
  return '';
}

function toNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function estimateTokenCount(text: string): number {
  const normalized = normalizeText(text);
  return normalized ? Math.max(1, Math.ceil(normalized.length / 3)) : 0;
}

function strongestFamilyComparison(candidates: DuplicateWorldbookCandidate[]): FingerprintComparison {
  let strongest: FingerprintComparison = {
    similarity: 0,
    leftCoverage: 0,
    rightCoverage: 0,
    smallerCoverage: 0,
    overlap: 0,
    union: 0,
    exact: false,
  };

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const comparison = compareFingerprints(candidates[leftIndex].fingerprint, candidates[rightIndex].fingerprint);
      if (
        comparison.exact ||
        comparison.similarity > strongest.similarity ||
        comparison.smallerCoverage > strongest.smallerCoverage
      ) {
        strongest = comparison;
      }
    }
  }

  return strongest;
}

function compareFingerprints(
  left: DuplicateWorldbookContentFingerprint,
  right: DuplicateWorldbookContentFingerprint,
): FingerprintComparison {
  const leftSet = new Set(left.enabledEntryHashes.length > 0 ? left.enabledEntryHashes : left.entryHashes);
  const rightSet = new Set(right.enabledEntryHashes.length > 0 ? right.enabledEntryHashes : right.entryHashes);
  const overlap = countIntersection(leftSet, rightSet);
  const union = new Set([...leftSet, ...rightSet]).size;
  const similarity = union === 0 ? 1 : overlap / union;
  const leftCoverage = leftSet.size === 0 ? 1 : overlap / leftSet.size;
  const rightCoverage = rightSet.size === 0 ? 1 : overlap / rightSet.size;

  return {
    similarity,
    leftCoverage,
    rightCoverage,
    smallerCoverage: Math.max(leftCoverage, rightCoverage),
    overlap,
    union,
    exact: left.contentHash === right.contentHash || left.enabledContentHash === right.enabledContentHash,
  };
}

function countIntersection(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function classifyConfidence(comparison: FingerprintComparison): DuplicateWorldbookConfidence {
  if (comparison.exact) return 'exact';
  if (comparison.similarity >= HIGH_SIMILARITY || comparison.smallerCoverage >= HIGH_COVERAGE) return 'high';
  if (comparison.similarity >= MEDIUM_SIMILARITY || comparison.smallerCoverage >= MEDIUM_COVERAGE) return 'medium';
  return 'low';
}

function chooseKeepCandidate(candidates: DuplicateWorldbookCandidate[]): DuplicateWorldbookCandidate {
  return [...candidates].sort(compareCandidatesForKeep)[0];
}

function compareCandidatesForKeep(left: DuplicateWorldbookCandidate, right: DuplicateWorldbookCandidate): number {
  const leftVersion = versionSortValue(left.versionInfo);
  const rightVersion = versionSortValue(right.versionInfo);
  if (leftVersion !== rightVersion) return rightVersion - leftVersion;
  if (left.versionInfo.isCopy !== right.versionInfo.isCopy) return left.versionInfo.isCopy ? 1 : -1;
  const entryDiff = right.fingerprint.enabledEntryCount - left.fingerprint.enabledEntryCount;
  if (entryDiff !== 0) return entryDiff;
  const tokenDiff = right.fingerprint.tokenEstimate - left.fingerprint.tokenEstimate;
  if (tokenDiff !== 0) return tokenDiff;
  return left.name.localeCompare(right.name, 'zh-Hans-CN');
}

function versionSortValue(info: WorldbookNameVersionInfo): number {
  if (info.versionScore === null) return info.isCopy ? -1 : 0;
  return info.versionRank * 100000000 + info.versionScore - (info.isCopy ? 10000000 : 0);
}

function sortCandidatesForDisplay(candidates: DuplicateWorldbookCandidate[]): DuplicateWorldbookCandidate[] {
  return [...candidates].sort(compareCandidatesForKeep);
}

function shortestFamilyName(names: string[]): string {
  return [...names].sort((left, right) => left.length - right.length || left.localeCompare(right, 'zh-Hans-CN'))[0] ?? '';
}

function formatDuplicateReason(confidence: DuplicateWorldbookConfidence, comparison: FingerprintComparison): string {
  if (confidence === 'exact') return '内容指纹完全一致';
  if (comparison.smallerCoverage >= HIGH_COVERAGE) return `其中一本已被另一本覆盖 ${formatPercent(comparison.smallerCoverage)}`;
  if (comparison.similarity >= HIGH_SIMILARITY) return `条目相似度 ${formatPercent(comparison.similarity)}`;
  if (confidence === 'medium') return `内容相似或包含关系 ${formatPercent(Math.max(comparison.similarity, comparison.smallerCoverage))}`;
  return `名称属于同一组，内容相似度较低 ${formatPercent(Math.max(comparison.similarity, comparison.smallerCoverage))}`;
}

function createGroupWarnings(
  keepCandidate: DuplicateWorldbookCandidate,
  deleteCandidates: DuplicateWorldbookCandidate[],
): string[] {
  const warnings: string[] = [];
  const activeDeleteCandidates = deleteCandidates.filter(candidate => candidate.sources.length > 0);
  if (activeDeleteCandidates.length > 0) {
    warnings.push('待删除版本当前有绑定，应用时会先重绑到保留版本');
  }
  if (keepCandidate.versionInfo.versionScore === null) {
    warnings.push('保留建议未找到明确版本号，已用内容规模作为兜底排序');
  }
  return warnings;
}

function compareDuplicateGroups(left: DuplicateWorldbookGroup, right: DuplicateWorldbookGroup): number {
  const confidenceRank: Record<DuplicateWorldbookConfidence, number> = { exact: 0, high: 1, medium: 2, low: 3 };
  return (
    confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
    right.deleteCandidates.length - left.deleteCandidates.length ||
    left.familyName.localeCompare(right.familyName, 'zh-Hans-CN')
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function replaceDeletedNames(names: string[], deleted: Set<string>, keepName: string): string[] {
  const result: string[] = [];
  for (const name of names) {
    const nextName = deleted.has(name) ? keepName : name;
    if (!result.includes(nextName)) result.push(nextName);
  }
  return result;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueSources(sources: DuplicateWorldbookSource[]): DuplicateWorldbookSource[] {
  const order: Record<DuplicateWorldbookSource, number> = {
    chat: 0,
    character_primary: 1,
    character_additional: 2,
    global: 3,
  };
  return [...new Set(sources)].sort((left, right) => order[left] - order[right]);
}
