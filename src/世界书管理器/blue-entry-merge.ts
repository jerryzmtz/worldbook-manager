import { isMvuMergeProtectedEntry } from './mvu-merge-guard';

export {
  getMvuMergeGuardReason,
  isMvuMergeProtectedEntry,
  type MvuMergeGuardReason,
} from './mvu-merge-guard';

export type MergeEntryPositionType =
  | 'before_character_definition'
  | 'after_character_definition'
  | 'before_example_messages'
  | 'after_example_messages'
  | 'before_author_note'
  | 'after_author_note'
  | 'at_depth'
  | 'outlet';

export type MergeEntryRole = 'system' | 'assistant' | 'user';

export type MergeEntryPosition = {
  type: MergeEntryPositionType;
  role: MergeEntryRole;
  depth: number;
  order: number;
};

export type MergeEntry = {
  uid: number;
  name: string;
  enabled: boolean;
  strategy: {
    type: 'constant' | 'selective' | 'vectorized';
    keys: unknown[];
    keys_secondary: { logic: string; keys: unknown[] };
    scan_depth: 'same_as_global' | number;
  };
  position: MergeEntryPosition;
  content: string;
  probability: number;
  recursion: {
    prevent_incoming: boolean;
    prevent_outgoing: boolean;
    delay_until: null | number;
  };
  effect: {
    sticky: null | number;
    cooldown: null | number;
    delay: null | number;
  };
  extra?: Record<string, unknown>;
  addMemo?: boolean;
  matchPersonaDescription?: boolean;
  matchCharacterDescription?: boolean;
  matchCharacterPersonality?: boolean;
  matchCharacterDepthPrompt?: boolean;
  matchScenario?: boolean;
  matchCreatorNotes?: boolean;
  group?: string;
  groupOverride?: boolean;
  groupWeight?: number;
  caseSensitive?: boolean | null;
  matchWholeWords?: boolean | null;
  useGroupScoring?: boolean | null;
  automationId?: string;
  ignoreBudget?: boolean;
  outletName?: string;
  triggers?: unknown[];
  characterFilter?: {
    isExclude: boolean;
    names: string[];
    tags: string[];
  };
};

export type MergeRiskHit = {
  level: 'dynamic' | 'unknown' | 'warning';
};

export type MergeBook<T extends MergeEntry> = {
  name: string;
  entries: T[];
};

export type MergeGroup<T extends MergeEntry> = {
  id: string;
  worldbook: string;
  positionKey: string;
  position: MergeEntryPosition;
  sourceEntries: T[];
  sourceUids: number[];
  sourceNames: string[];
  sourceIndices: number[];
  mergedEntry: T;
  content: string;
  tokenEstimate: number;
};

export type MergeBookPlan<T extends MergeEntry> = {
  worldbook: string;
  groups: MergeGroup<T>[];
  entries: T[];
  removedCount: number;
  addedCount: number;
};

export type MergePlan<T extends MergeEntry> = {
  books: MergeBookPlan<T>[];
  groups: MergeGroup<T>[];
  removedCount: number;
  addedCount: number;
};

export type CreateBlueEntryMergePlanOptions<T extends MergeEntry> = {
  detectRisks?: (entry: T) => MergeRiskHit[];
  estimateTokens?: (text: string) => number;
};

type IndexedEntry<T extends MergeEntry> = {
  entry: T;
  index: number;
  positionKey: string | null;
  signature: string | null;
};

const MERGEABLE_POSITION_TYPES = new Set<MergeEntryPositionType>([
  'before_character_definition',
  'after_character_definition',
  'before_author_note',
  'after_author_note',
  'at_depth',
]);

export function createBlueEntryMergePlan<T extends MergeEntry>(
  books: MergeBook<T>[],
  options: CreateBlueEntryMergePlanOptions<T> = {},
): MergePlan<T> {
  const bookPlans = books.map(book => createBlueEntryMergeBookPlan(book, options));
  return {
    books: bookPlans,
    groups: bookPlans.flatMap(book => book.groups),
    removedCount: bookPlans.reduce((sum, book) => sum + book.removedCount, 0),
    addedCount: bookPlans.reduce((sum, book) => sum + book.addedCount, 0),
  };
}

function createBlueEntryMergeBookPlan<T extends MergeEntry>(
  book: MergeBook<T>,
  options: CreateBlueEntryMergePlanOptions<T>,
): MergeBookPlan<T> {
  const indexed = book.entries
    .map<IndexedEntry<T>>((entry, index) => ({
      entry,
      index,
      positionKey: mergeablePositionKey(entry.position),
      signature: mergeSignature(entry),
    }))
    .sort((left, right) => promptOrderRank(left.entry, left.index) - promptOrderRank(right.entry, right.index));

  const groupItems: Array<Array<IndexedEntry<T>>> = [];
  let current: Array<IndexedEntry<T>> = [];
  let currentKey = '';
  let currentSignature = '';

  const flush = () => {
    if (current.length >= 2) {
      groupItems.push(current);
    }
    current = [];
    currentKey = '';
    currentSignature = '';
  };

  for (const item of indexed) {
    const candidate = isMergeCandidate(item.entry, options.detectRisks) && item.positionKey && item.signature;
    if (!candidate) {
      flush();
      continue;
    }

    if (current.length > 0 && (item.positionKey !== currentKey || item.signature !== currentSignature)) {
      flush();
    }

    current.push(item);
    currentKey = item.positionKey;
    currentSignature = item.signature;
  }

  flush();

  // Reuse the smallest source uid so SillyTavern's uid tie-break keeps merged blocks
  // in the same relative slot when entries share the same order value.
  const groups = groupItems.map(items => {
    const minUid = Math.min(...items.map(item => item.entry.uid));
    return createMergeGroup(book.name, items, minUid, options);
  });
  const entries = applyMergeGroups(book.entries, groups);
  return {
    worldbook: book.name,
    groups,
    entries,
    removedCount: groups.reduce((sum, group) => sum + group.sourceEntries.length, 0),
    addedCount: groups.length,
  };
}

function createMergeGroup<T extends MergeEntry>(
  worldbook: string,
  items: Array<IndexedEntry<T>>,
  uid: number,
  options: CreateBlueEntryMergePlanOptions<T>,
): MergeGroup<T> {
  const sourceEntries = items.map(item => item.entry);
  const first = sourceEntries[0];
  const bodyContent = sourceEntries.map(entry => entry.content).join('\n');
  const content = `${mergeSourceNamesComment(sourceEntries)}\n${bodyContent}`;
  const mergedEntry = {
    ...first,
    uid,
    name: mergeEntryName(sourceEntries),
    content,
    position: { ...first.position },
    strategy: {
      ...first.strategy,
      keys: [...first.strategy.keys],
      keys_secondary: {
        ...first.strategy.keys_secondary,
        keys: [...first.strategy.keys_secondary.keys],
      },
    },
    recursion: { ...first.recursion },
    effect: { ...first.effect },
    extra: first.extra ? { ...first.extra } : undefined,
  } as T;

  return {
    id: `${worldbook}:${items.map(item => item.entry.uid).join('+')}`,
    worldbook,
    positionKey: items[0].positionKey ?? '',
    position: { ...first.position },
    sourceEntries,
    sourceUids: sourceEntries.map(entry => entry.uid),
    sourceNames: sourceEntries.map(entry => entry.name || '(未命名)'),
    sourceIndices: items.map(item => item.index),
    mergedEntry,
    content,
    tokenEstimate: options.estimateTokens?.(content) ?? estimateTokenCount(content),
  };
}

function applyMergeGroups<T extends MergeEntry>(entries: T[], groups: Array<MergeGroup<T>>): T[] {
  if (groups.length === 0) return entries;
  const byFirstIndex = new Map(groups.map(group => [Math.min(...group.sourceIndices), group]));
  const removedUids = new Set(groups.flatMap(group => group.sourceUids));
  const result: T[] = [];

  entries.forEach((entry, index) => {
    const group = byFirstIndex.get(index);
    if (group) result.push(group.mergedEntry);
    if (!removedUids.has(entry.uid)) result.push(entry);
  });

  return result;
}

function isMergeCandidate<T extends MergeEntry>(
  entry: T,
  detectRisks: CreateBlueEntryMergePlanOptions<T>['detectRisks'],
): boolean {
  if (isMvuMergeProtectedEntry(entry)) return false;
  if (!entry.enabled || entry.strategy.type !== 'constant') return false;
  if (entry.probability !== 100 || entry.ignoreBudget) return false;
  if (!entry.content || hasDecoratorDirective(entry.content)) return false;
  if (!MERGEABLE_POSITION_TYPES.has(entry.position.type)) return false;
  if (entry.position.type === 'outlet' || entry.position.type === 'before_example_messages') return false;
  if (entry.position.type === 'after_example_messages') return false;
  if (entry.effect.sticky !== null || entry.effect.cooldown !== null || entry.effect.delay !== null) return false;
  if (entry.recursion.delay_until !== null) return false;
  if (entry.extra && Object.keys(entry.extra).length > 0) return false;
  if ((entry.group ?? '') !== '' || entry.groupOverride === true) return false;
  if ((entry.automationId ?? '') !== '') return false;
  if ((entry.outletName ?? '') !== '') return false;
  if (Array.isArray(entry.triggers) && entry.triggers.length > 0) return false;
  if (entry.characterFilter) {
    if (entry.characterFilter.isExclude) return false;
    if (entry.characterFilter.names.length > 0 || entry.characterFilter.tags.length > 0) return false;
  }
  if (detectRisks?.(entry).some(risk => risk.level === 'dynamic' || risk.level === 'unknown')) return false;
  return true;
}

function hasDecoratorDirective(content: string): boolean {
  return /^\s*@@[a-z_]+/imu.test(content);
}

function mergeablePositionKey(position: MergeEntryPosition): string | null {
  if (!MERGEABLE_POSITION_TYPES.has(position.type)) return null;
  if (position.type === 'at_depth') return `at_depth:${position.role}:${position.depth}`;
  return position.type;
}

function mergeSignature(entry: MergeEntry): string {
  return JSON.stringify({
    positionKey: mergeablePositionKey(entry.position),
    preventIncoming: entry.recursion.prevent_incoming,
    preventOutgoing: entry.recursion.prevent_outgoing,
    addMemo: entry.addMemo ?? true,
    matchPersonaDescription: entry.matchPersonaDescription ?? false,
    matchCharacterDescription: entry.matchCharacterDescription ?? false,
    matchCharacterPersonality: entry.matchCharacterPersonality ?? false,
    matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt ?? false,
    matchScenario: entry.matchScenario ?? false,
    matchCreatorNotes: entry.matchCreatorNotes ?? false,
    groupWeight: entry.groupWeight ?? 100,
    caseSensitive: entry.caseSensitive ?? null,
    matchWholeWords: entry.matchWholeWords ?? null,
    useGroupScoring: entry.useGroupScoring ?? null,
  });
}

function promptOrderRank(entry: MergeEntry, index: number): number {
  const order = Number.isFinite(entry.position.order) ? entry.position.order : 0;
  if (entry.position.type === 'at_depth') {
    return 1_000_000 - entry.position.depth * 100_000 + order + index / 100_000;
  }
  const baseMap: Record<Exclude<MergeEntryPositionType, 'at_depth'>, number> = {
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

function mergeEntryName<T extends MergeEntry>(entries: T[]): string {
  const firstName = entries[0]?.name?.trim() || '未命名';
  return `合并蓝灯：${firstName}${entries.length > 1 ? ` 等 ${entries.length} 条` : ''}`;
}

function mergeSourceNamesComment<T extends MergeEntry>(entries: T[]): string {
  const sourceNames = entries.map(entry => sanitizeMergeCommentName(entry.name || `UID ${entry.uid}`)).join('；');
  return `{{// 合并来源：${sourceNames}}}`;
}

function sanitizeMergeCommentName(name: string): string {
  return name.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() || '未命名';
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}
