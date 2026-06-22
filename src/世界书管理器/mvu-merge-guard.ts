/**
 * MVU-related merge guards for worldbook-manager.
 *
 * Two layers (complementary, not duplicate):
 * 1. Protocol — entry name / initvar markers that MagVarUpdate uses to route lore
 *    between story AI and variable-update AI. Hard-blocked in blue merge.
 * 2. Runtime body — stat_data / tavern variable macros in lore text. Surfaced as
 *    preview risks and blocked via detectEntryRisks() like before this module.
 *
 * Plugin internal field `entry.name` is SillyTavern worldbook `comment` (备注名).
 */

export type MvuMergeGuardEntry = {
  /** ST worldbook comment / 备注名 */
  name?: string;
  content?: string;
};

/** MagVarUpdate CHAT_COMPLETION_SETTINGS_READY lore filter. */
export const MVU_STORY_VARIABLE_SPLIT_COMMENT = /\[(?:mvu_update|mvu_plot)\]/i;

/** MagVarUpdate init scan: comment.toLowerCase().includes('[initvar]'). */
export const MVU_INITVAR_COMMENT_MARKER = '[initvar]';

/** MagVarUpdate init scan: <initvar> block in content. */
export const MVU_INITVAR_CONTENT_OPEN = /<initvar[\s>]/i;

/** Former detectEntryRisks "MVU变量" body heuristic. */
export const MVU_RUNTIME_BODY_PATTERN = /stat_data|Mvu|mvu/;

/** Former detectEntryRisks tavern-helper variable macro heuristic. */
export const TAVERN_VARIABLE_MACRO_PATTERN =
  /\{\{(?:(?:get|format)_(?:global|preset|character|chat|message)_variable|format_(?:global|preset|character|chat|message)_message)::/i;

const MERGE_SOURCE_HEADER = /^\s*\{\{\/\/\s*合并来源：/;

export type MvuMergeGuardReason =
  | 'mvu_routing_comment'
  | 'mvu_initvar'
  | 'mvu_protocol_in_merge_header';

export type MvuMergeSignals = {
  protocol: MvuMergeGuardReason | null;
  runtimeBody: boolean;
  tavernMacro: boolean;
};

export function getMvuMergeGuardReason(entry: MvuMergeGuardEntry): MvuMergeGuardReason | null {
  const name = entry.name ?? '';
  if (MVU_STORY_VARIABLE_SPLIT_COMMENT.test(name)) {
    return 'mvu_routing_comment';
  }

  const content = entry.content ?? '';
  if (name.toLowerCase().includes(MVU_INITVAR_COMMENT_MARKER)) {
    return 'mvu_initvar';
  }
  if (MVU_INITVAR_CONTENT_OPEN.test(content)) {
    return 'mvu_initvar';
  }

  const header = content.trimStart().split('\n', 1)[0] ?? '';
  if (MERGE_SOURCE_HEADER.test(header)) {
    if (MVU_STORY_VARIABLE_SPLIT_COMMENT.test(header) || /\[initvar\]/i.test(header)) {
      return 'mvu_protocol_in_merge_header';
    }
  }

  return null;
}

/** Protocol-only guard (MagVarUpdate comment/initvar classification). */
export function isMvuMergeProtectedEntry(entry: MvuMergeGuardEntry): boolean {
  return getMvuMergeGuardReason(entry) !== null;
}

export function getMvuMergeSignals(entry: MvuMergeGuardEntry): MvuMergeSignals {
  const content = entry.content ?? '';
  return {
    protocol: getMvuMergeGuardReason(entry),
    runtimeBody: MVU_RUNTIME_BODY_PATTERN.test(content),
    tavernMacro: TAVERN_VARIABLE_MACRO_PATTERN.test(content),
  };
}

/** Hard block for blue merge — protocol layer only. */
export function shouldSkipBlueMergeForMvuProtocol(entry: MvuMergeGuardEntry): boolean {
  return isMvuMergeProtectedEntry(entry);
}

export function getMvuProtocolRiskLabel(reason: MvuMergeGuardReason): string {
  switch (reason) {
    case 'mvu_routing_comment':
      return 'MVU分流备注';
    case 'mvu_initvar':
      return 'MVU初始化';
    case 'mvu_protocol_in_merge_header':
      return '合并来源含MVU协议名';
  }
}
