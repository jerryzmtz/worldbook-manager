/**
 * Skip blue-entry merge for worldbook entries that MVU already classifies by
 * entry name/comment (and initvar markers), not by arbitrary lore body text.
 *
 * Rationale: MVU's story/variable split filters lore with
 *   /\[mvu_update\]/i and /\[mvu_plot\]/i on entry.comment (MagVarUpdate).
 * Merging rewrites comment to "合并蓝灯：…", so a formerly tagged entry would be
 * injected into both AIs instead of following MVU routing.
 *
 * We mirror MVU's own discovery rules instead of guessing future YAML/JSON bodies.
 */

export type MvuMergeGuardEntry = {
  name?: string;
  content?: string;
};

/** MagVarUpdate CHAT_COMPLETION_SETTINGS_READY lore filter. */
export const MVU_STORY_VARIABLE_SPLIT_COMMENT = /\[(?:mvu_update|mvu_plot)\]/i;

/** MagVarUpdate init scan: comment.toLowerCase().includes('[initvar]'). */
export const MVU_INITVAR_COMMENT_MARKER = '[initvar]';

/** MagVarUpdate init scan: <initvar> block in content. */
export const MVU_INITVAR_CONTENT_OPEN = /<initvar[\s>]/i;

const MERGE_SOURCE_HEADER = /^\s*\{\{\/\/\s*合并来源：/;

export type MvuMergeGuardReason =
  | 'mvu_routing_comment'
  | 'mvu_initvar'
  | 'mvu_protocol_in_merge_header';

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

export function isMvuMergeProtectedEntry(entry: MvuMergeGuardEntry): boolean {
  return getMvuMergeGuardReason(entry) !== null;
}
