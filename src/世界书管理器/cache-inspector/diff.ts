import type {
  PromptDiffContext,
  PromptDiffResult,
  PromptFullTextSegment,
  PromptMessageSnapshot,
  PromptSnapshotRecord,
  PromptTextRange,
} from './types';

const DEFAULT_CONTEXT_SIZE = 800;

type PromptComparable = Pick<PromptSnapshotRecord, 'messages'>;
type IndexedPromptMessage = {
  index: number;
  message: PromptMessageSnapshot;
};
type PromptMessageDifference =
  | { kind: 'message_added'; afterItem: IndexedPromptMessage }
  | { kind: 'message_removed'; beforeItem: IndexedPromptMessage }
  | { kind: 'message_changed'; beforeItem: IndexedPromptMessage; afterItem: IndexedPromptMessage };

export function createTextHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function comparePromptRecords(
  before: PromptComparable | null,
  after: PromptComparable | null,
  contextSize = DEFAULT_CONTEXT_SIZE,
): PromptDiffResult {
  if (!before || !after) {
    return emptyDiff('请选择两条可对比记录。');
  }

  const beforeMessages = comparableMessages(before.messages);
  const afterMessages = comparableMessages(after.messages);
  const hasOnlyPlaceholderChanges =
    beforeMessages.length !== before.messages.length || afterMessages.length !== after.messages.length;
  const difference = findFirstMessageDifference(beforeMessages, afterMessages);
  if (difference?.kind === 'message_added') {
    return buildMessageAddedDiff(difference.afterItem.index, difference.afterItem.message, contextSize);
  }
  if (difference?.kind === 'message_removed') {
    return buildMessageRemovedDiff(difference.beforeItem.index, difference.beforeItem.message, contextSize);
  }
  if (difference?.kind === 'message_changed') {
    const { beforeItem, afterItem } = difference;
    const beforeMessage = beforeItem.message;
    const afterMessage = afterItem.message;
    if (beforeMessage.role !== afterMessage.role) {
      return {
        kind: 'role_changed',
        summary: `第 ${afterItem.index + 1} 条有效消息的身份从 ${beforeMessage.role} 变为 ${afterMessage.role}。`,
        index: afterItem.index,
        beforeIndex: beforeItem.index,
        afterIndex: afterItem.index,
        beforeRole: beforeMessage.role,
        afterRole: afterMessage.role,
        beforeLength: beforeMessage.length,
        afterLength: afterMessage.length,
        context: buildDiffContext(beforeMessage.text, afterMessage.text, contextSize),
      };
    }
    return {
      kind: 'content_changed',
      summary: `第 ${afterItem.index + 1} 条有效 ${afterMessage.role} 消息内容发生变化。`,
      index: afterItem.index,
      beforeIndex: beforeItem.index,
      afterIndex: afterItem.index,
      beforeRole: beforeMessage.role,
      afterRole: afterMessage.role,
      beforeLength: beforeMessage.length,
      afterLength: afterMessage.length,
      context: buildDiffContext(beforeMessage.text, afterMessage.text, contextSize),
    };
  }

  return {
    kind: 'same',
    summary: hasOnlyPlaceholderChanges
      ? '两次请求的有效提示词文本一致，仅空消息占位不同。'
      : '两次请求的 messages 完全一致。',
    index: null,
    beforeIndex: null,
    afterIndex: null,
    beforeRole: null,
    afterRole: null,
    beforeLength: before.messages.reduce((sum, message) => sum + message.length, 0),
    afterLength: after.messages.reduce((sum, message) => sum + message.length, 0),
    context: null,
  };
}

function comparableMessages(messages: PromptMessageSnapshot[]): IndexedPromptMessage[] {
  return messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) => message.text.trim().length > 0);
}

function findFirstMessageDifference(
  beforeMessages: IndexedPromptMessage[],
  afterMessages: IndexedPromptMessage[],
): PromptMessageDifference | null {
  const costs = buildAlignmentCosts(beforeMessages, afterMessages);
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeMessages.length || afterIndex < afterMessages.length) {
    const beforeItem = beforeMessages[beforeIndex];
    const afterItem = afterMessages[afterIndex];
    if (!beforeItem && afterItem) return { kind: 'message_added', afterItem };
    if (beforeItem && !afterItem) return { kind: 'message_removed', beforeItem };
    if (!beforeItem || !afterItem) return null;

    if (isSameMessage(beforeItem.message, afterItem.message)) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const currentCost = costs[beforeIndex][afterIndex];
    const changedCost =
      replacementCost(beforeItem.message, afterItem.message) + costs[beforeIndex + 1][afterIndex + 1];
    const addedCost = 1 + costs[beforeIndex][afterIndex + 1];
    const removedCost = 1 + costs[beforeIndex + 1][afterIndex];

    if (beforeItem.message.role === afterItem.message.role && changedCost === currentCost) {
      return { kind: 'message_changed', beforeItem, afterItem };
    }

    const addedIsBest = addedCost === currentCost;
    const removedIsBest = removedCost === currentCost;
    const beforeRemaining = beforeMessages.length - beforeIndex;
    const afterRemaining = afterMessages.length - afterIndex;
    if (addedIsBest && afterRemaining > beforeRemaining) return { kind: 'message_added', afterItem };
    if (removedIsBest && beforeRemaining > afterRemaining) return { kind: 'message_removed', beforeItem };
    if (changedCost === currentCost) return { kind: 'message_changed', beforeItem, afterItem };
    if (addedIsBest) return { kind: 'message_added', afterItem };
    if (removedIsBest) return { kind: 'message_removed', beforeItem };
    return { kind: 'message_changed', beforeItem, afterItem };
  }

  return null;
}

function buildAlignmentCosts(
  beforeMessages: IndexedPromptMessage[],
  afterMessages: IndexedPromptMessage[],
): number[][] {
  const costs = Array.from({ length: beforeMessages.length + 1 }, () =>
    Array<number>(afterMessages.length + 1).fill(0),
  );
  for (let beforeIndex = beforeMessages.length; beforeIndex >= 0; beforeIndex -= 1) {
    costs[beforeIndex][afterMessages.length] = beforeMessages.length - beforeIndex;
  }
  for (let afterIndex = afterMessages.length; afterIndex >= 0; afterIndex -= 1) {
    costs[beforeMessages.length][afterIndex] = afterMessages.length - afterIndex;
  }

  for (let beforeIndex = beforeMessages.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterMessages.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const beforeMessage = beforeMessages[beforeIndex].message;
      const afterMessage = afterMessages[afterIndex].message;
      if (isSameMessage(beforeMessage, afterMessage)) {
        costs[beforeIndex][afterIndex] = costs[beforeIndex + 1][afterIndex + 1];
        continue;
      }
      costs[beforeIndex][afterIndex] = Math.min(
        replacementCost(beforeMessage, afterMessage) + costs[beforeIndex + 1][afterIndex + 1],
        1 + costs[beforeIndex][afterIndex + 1],
        1 + costs[beforeIndex + 1][afterIndex],
      );
    }
  }

  return costs;
}

function replacementCost(beforeMessage: PromptMessageSnapshot, afterMessage: PromptMessageSnapshot): number {
  return beforeMessage.role === afterMessage.role ? 1 : 2;
}

function isSameMessage(beforeMessage: PromptMessageSnapshot, afterMessage: PromptMessageSnapshot): boolean {
  return (
    beforeMessage.role === afterMessage.role &&
    beforeMessage.hash === afterMessage.hash &&
    beforeMessage.text === afterMessage.text
  );
}

export function buildFullTextSegments(
  text: string,
  range: PromptTextRange | null,
  loadedLength: number,
  side: 'before' | 'after',
): PromptFullTextSegment[] {
  const cappedLength = Math.max(0, Math.min(text.length, loadedLength));
  if (!range) {
    return text.slice(0, cappedLength) ? [{ id: `${side}-context`, text: text.slice(0, cappedLength), kind: 'context', marker: false }] : [];
  }

  const segments: PromptFullTextSegment[] = [];
  const markerStart = Math.min(range.start, cappedLength);
  const markerEnd = Math.min(range.end, cappedLength);

  pushSegment(segments, `${side}-prefix`, text.slice(0, markerStart), 'context', false);

  if (cappedLength >= range.start) {
    const changedText = text.slice(range.start, markerEnd);
    pushSegment(segments, `${side}-changed`, changedText || '∅', 'changed', true);
  }

  if (cappedLength > range.end) {
    pushSegment(segments, `${side}-suffix`, text.slice(range.end, cappedLength), 'context', false);
  }

  return segments;
}

function pushSegment(
  segments: PromptFullTextSegment[],
  id: string,
  text: string,
  kind: PromptFullTextSegment['kind'],
  marker: boolean,
): void {
  if (!text && !marker) return;
  segments.push({ id, text, kind, marker });
}

function buildMessageAddedDiff(
  index: number,
  message: PromptMessageSnapshot,
  contextSize: number,
): PromptDiffResult {
  return {
    kind: 'message_added',
    summary: `第 ${index + 1} 条有效 ${message.role} 消息是新增消息。`,
    index,
    beforeIndex: null,
    afterIndex: index,
    beforeRole: null,
    afterRole: message.role,
    beforeLength: 0,
    afterLength: message.length,
    context: buildDiffContext('', message.text, contextSize),
  };
}

function buildMessageRemovedDiff(
  index: number,
  message: PromptMessageSnapshot,
  contextSize: number,
): PromptDiffResult {
  return {
    kind: 'message_removed',
    summary: `第 ${index + 1} 条有效 ${message.role} 消息在后一次请求中消失。`,
    index,
    beforeIndex: index,
    afterIndex: null,
    beforeRole: message.role,
    afterRole: null,
    beforeLength: message.length,
    afterLength: 0,
    context: buildDiffContext(message.text, '', contextSize),
  };
}

function buildDiffContext(beforeText: string, afterText: string, contextSize: number): PromptDiffContext {
  const prefixLength = commonPrefixLength(beforeText, afterText);
  const suffixLength = commonSuffixLength(beforeText, afterText, prefixLength);
  const beforeEnd = beforeText.length - suffixLength;
  const afterEnd = afterText.length - suffixLength;
  const beforeChanged = beforeText.slice(prefixLength, beforeEnd);
  const afterChanged = afterText.slice(prefixLength, afterEnd);
  const prefixStart = Math.max(0, prefixLength - contextSize);
  const suffixEnd = Math.min(beforeText.length, beforeEnd + contextSize);

  return {
    prefix: beforeText.slice(prefixStart, prefixLength),
    beforeChanged: beforeChanged.slice(0, contextSize * 2),
    afterChanged: afterChanged.slice(0, contextSize * 2),
    suffix: beforeText.slice(beforeEnd, suffixEnd),
    prefixLength,
    suffixLength,
    beforeChangedLength: beforeChanged.length,
    afterChangedLength: afterChanged.length,
    beforeRange: buildRange(prefixLength, beforeEnd),
    afterRange: buildRange(prefixLength, afterEnd),
    hasMorePrefix: prefixStart > 0,
    hasMoreSuffix: suffixEnd < beforeText.length,
  };
}

function buildRange(start: number, end: number): PromptTextRange {
  return {
    start,
    end,
    length: Math.max(0, end - start),
  };
}

function commonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;
  let length = 0;

  while (leftIndex >= prefixLength && rightIndex >= prefixLength && left[leftIndex] === right[rightIndex]) {
    leftIndex -= 1;
    rightIndex -= 1;
    length += 1;
  }

  return length;
}

function emptyDiff(summary: string): PromptDiffResult {
  return {
    kind: 'same',
    summary,
    index: null,
    beforeIndex: null,
    afterIndex: null,
    beforeRole: null,
    afterRole: null,
    beforeLength: 0,
    afterLength: 0,
    context: null,
  };
}
