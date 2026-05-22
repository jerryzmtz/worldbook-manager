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
  const maxLength = Math.max(beforeMessages.length, afterMessages.length);
  for (let index = 0; index < maxLength; index += 1) {
    const beforeItem = beforeMessages[index];
    const afterItem = afterMessages[index];
    const beforeMessage = beforeItem?.message;
    const afterMessage = afterItem?.message;

    if (!beforeMessage && afterMessage) {
      return buildMessageAddedDiff(afterItem.index, afterMessage, contextSize);
    }
    if (beforeMessage && !afterMessage) {
      return buildMessageRemovedDiff(beforeItem.index, beforeMessage, contextSize);
    }
    if (!beforeMessage || !afterMessage) continue;

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

    if (beforeMessage.hash !== afterMessage.hash || beforeMessage.text !== afterMessage.text) {
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
