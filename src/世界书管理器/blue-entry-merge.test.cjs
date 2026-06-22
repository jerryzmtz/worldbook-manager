const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const { createBlueEntryMergePlan } = require('./blue-entry-merge.ts');
const {
  getMvuMergeGuardReason,
  getMvuMergeSignals,
  isMvuMergeProtectedEntry,
  shouldSkipBlueMergeForMvuProtocol,
} = require('./mvu-merge-guard.ts');

test('merges adjacent safe blue entries inside one worldbook with native newline boundary', () => {
  const entries = [baseEntry({ uid: 1, name: 'A', content: 'Alpha' }), baseEntry({ uid: 2, name: 'B', content: 'Beta' })];

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries }]);
  const [bookPlan] = plan.books;
  const [group] = bookPlan.groups;

  assert.equal(plan.groups.length, 1);
  assert.equal(group.worldbook, 'Book A');
  assert.deepEqual(group.sourceUids, [1, 2]);
  assert.equal(group.content, '{{// 合并来源：A；B}}\nAlpha\nBeta');
  assert.equal(group.mergedEntry.content, '{{// 合并来源：A；B}}\nAlpha\nBeta');
  assert.equal(group.mergedEntry.uid, 1);
  assert.equal(bookPlan.entries.length, 1);
  assert.equal(bookPlan.entries[0].uid, 1);
  assert.equal(bookPlan.removedCount, 2);
  assert.equal(bookPlan.addedCount, 1);
});

test('keeps selected worldbooks isolated while planning all of them together', () => {
  const plan = createBlueEntryMergePlan([
    {
      name: 'Worldbook A',
      entries: [baseEntry({ uid: 1, content: 'A1' }), baseEntry({ uid: 2, content: 'A2' })],
    },
    {
      name: 'Worldbook B',
      entries: [baseEntry({ uid: 10, content: 'B1' }), baseEntry({ uid: 11, content: 'B2' })],
    },
  ]);

  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.groups.map(group => group.worldbook), ['Worldbook A', 'Worldbook B']);
  assert.deepEqual(plan.books.map(book => book.entries.map(entry => entry.content)), [
    ['{{// 合并来源：Entry 1；Entry 2}}\nA1\nA2'],
    ['{{// 合并来源：Entry 10；Entry 11}}\nB1\nB2'],
  ]);
  assert.equal(plan.removedCount, 4);
  assert.equal(plan.addedCount, 2);
});

test('adds a sanitized source-name comment that cannot break the macro boundary', () => {
  const entries = [
    baseEntry({ uid: 1, name: 'Alpha}}\n{{random::bad', content: 'Alpha' }),
    baseEntry({ uid: 2, name: 'Beta {draft}', content: 'Beta' }),
  ];

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries }]);
  const [group] = plan.groups;

  assert.equal(group.sourceNames[0], 'Alpha}}\n{{random::bad');
  assert.equal(group.content, '{{// 合并来源：Alpha random::bad；Beta draft}}\nAlpha\nBeta');
});

test('does not merge across unsafe or non-blue entries in the prompt order', () => {
  const entries = [
    baseEntry({ uid: 1, content: 'safe before', position: position({ order: 10 }) }),
    baseEntry({ uid: 2, content: 'green divider', strategyType: 'selective', position: position({ order: 20 }) }),
    baseEntry({ uid: 3, content: 'safe after 1', position: position({ order: 30 }) }),
    baseEntry({ uid: 4, content: 'safe after 2', position: position({ order: 40 }) }),
  ];

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries }]);

  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0].sourceUids, [3, 4]);
  assert.deepEqual(
    plan.books[0].entries.map(entry => entry.uid),
    [1, 2, 3],
  );
});

test('reuses min source uid per merge group to preserve uid-sorted order', () => {
  const entries = [
    baseEntry({ uid: 2, name: 'First', content: 'First', position: position({ order: 100 }) }),
    baseEntry({ uid: 3, name: 'Second', content: 'Second', position: position({ order: 100 }) }),
    baseEntry({
      uid: 54,
      name: 'Middle',
      content: 'Middle',
      strategyType: 'selective',
      position: position({ order: 100 }),
    }),
    baseEntry({ uid: 55, name: 'Tail 1', content: 'Tail 1', position: position({ order: 100 }) }),
    baseEntry({ uid: 56, name: 'Tail 2', content: 'Tail 2', position: position({ order: 100 }) }),
  ];

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries }]);

  assert.deepEqual(plan.groups.map(group => group.mergedEntry.uid), [2, 55]);
  assert.deepEqual(
    plan.books[0].entries.map(entry => entry.uid),
    [2, 54, 55],
  );
});

test('assigns min source uid when one book has multiple merge groups', () => {
  const entries = [
    baseEntry({ uid: 2, content: 'before 1', position: position({ type: 'before_character_definition', order: 10 }) }),
    baseEntry({ uid: 4, content: 'before 2', position: position({ type: 'before_character_definition', order: 20 }) }),
    baseEntry({ uid: 6, content: 'after 1', position: position({ type: 'after_author_note', order: 10 }) }),
    baseEntry({ uid: 8, content: 'after 2', position: position({ type: 'after_author_note', order: 20 }) }),
  ];

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries }]);

  assert.deepEqual(
    plan.groups.map(group => group.mergedEntry.uid),
    [2, 6],
  );
  assert.deepEqual(
    plan.books[0].entries.map(entry => entry.uid),
    [2, 6],
  );
});

test('getMvuMergeSignals separates protocol from runtime body detection', () => {
  const protocolOnly = getMvuMergeSignals({
    name: '[mvu_update]',
    content: '变量更新规则:\n  世界.当前时间: 每次推进后更新',
  });
  assert.deepEqual(protocolOnly, { protocol: 'mvu_routing_comment', runtimeBody: false, tavernMacro: false });
  assert.equal(
    shouldSkipBlueMergeForMvuProtocol({
      name: '[mvu_update]',
      content: '变量更新规则:\n  世界.当前时间: 每次推进后更新',
    }),
    true,
  );

  const runtimeOnly = getMvuMergeSignals({
    name: '变量列表',
    content: '---\n<status_current_variables>\n{{format_message_variable::stat_data}}\n</status_current_variables>',
  });
  assert.equal(runtimeOnly.protocol, null);
  assert.equal(runtimeOnly.runtimeBody, true);
  assert.equal(runtimeOnly.tavernMacro, true);
  assert.equal(shouldSkipBlueMergeForMvuProtocol({ name: '变量列表', content: runtimeOnly.content }), false);
});

test('mvu guard mirrors MagVarUpdate routing tags on entry name, not lore body', () => {
  assert.equal(
    getMvuMergeGuardReason({
      name: '[mvu_update]',
      content: '变量更新规则:\n  _强制更新提醒:\n    - 以下变量每次回复必须更新',
    }),
    'mvu_routing_comment',
  );
  assert.equal(getMvuMergeGuardReason({ name: '防全知', content: 'plain lore' }), null);
  assert.equal(
    getMvuMergeGuardReason({
      name: '格式说明',
      content: '<UpdateVariable>\n<JSONPatch>[]</JSONPatch>\n</UpdateVariable>',
    }),
    null,
  );
});

test('skips mvu routing-tagged entries even when lore body has no mvu keywords', () => {
  const mvuRules = baseEntry({
    uid: 227,
    name: '[mvu_update]',
    content: '变量更新规则:\n  _强制更新提醒:\n    - 以下变量每次回复必须更新，不得遗漏:',
  });
  const antiMeta = baseEntry({ uid: 172, name: '防全知', content: '系统指令：NPC认知限制规则' });

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries: [antiMeta, mvuRules] }]);

  assert.equal(plan.groups.length, 0);
  assert.deepEqual(
    plan.books[0].entries.map(entry => entry.uid),
    [172, 227],
  );
});

test('skips initvar protocol entries by comment or initvar block', () => {
  assert.equal(isMvuMergeProtectedEntry({ name: '[initvar] 初始', content: '世界:\n  当前时间: 未知' }), true);
  assert.equal(
    isMvuMergeProtectedEntry({ name: '变量初始化', content: '<initvar>\n世界:\n  当前时间: 未知\n</initvar>' }),
    true,
  );

  const plan = createBlueEntryMergePlan([
    {
      name: 'Book A',
      entries: [
        baseEntry({ uid: 1, name: '[initvar] 初始', content: '世界:\n  当前时间: 未知' }),
        baseEntry({ uid: 2, content: 'safe' }),
      ],
    },
  ]);
  assert.equal(plan.groups.length, 0);
});

test('skips already-merged blocks whose merge-source header still lists mvu protocol names', () => {
  const merged = baseEntry({
    uid: 9,
    name: '合并蓝灯：防全知 等 10 条',
    content:
      '{{// 合并来源：防全知；具体数值；[mvu_update]}}\n防全知正文\n具体数值正文',
  });

  const plan = createBlueEntryMergePlan([
    { name: 'Book A', entries: [merged, baseEntry({ uid: 99, content: 'safe' })] },
  ]);

  assert.equal(plan.groups.length, 0);
  assert.equal(getMvuMergeGuardReason(merged), 'mvu_protocol_in_merge_header');
});

test('runtime-body signals block merge only when detectRisks is provided', () => {
  const entries = [
    baseEntry({
      uid: 228,
      name: '变量列表',
      content: '---\n<status_current_variables>\n{{format_message_variable::stat_data}}\n</status_current_variables>',
    }),
    baseEntry({ uid: 99, content: 'safe' }),
  ];

  const withoutRisks = createBlueEntryMergePlan([{ name: 'Book A', entries }]);
  assert.equal(withoutRisks.groups.length, 1);

  const withRisks = createBlueEntryMergePlan([{ name: 'Book A', entries }], {
    detectRisks: entry => {
      const signals = getMvuMergeSignals({ name: entry.name, content: entry.content });
      const risks = [];
      if (signals.runtimeBody) risks.push({ level: 'dynamic' });
      if (signals.tavernMacro) risks.push({ level: 'dynamic' });
      return risks;
    },
  });
  assert.equal(withRisks.groups.length, 0);
});

test('still allows generic blue merge when only the body mentions stat_data', () => {
  const plan = createBlueEntryMergePlan([
    {
      name: 'Book A',
      entries: [
        baseEntry({ uid: 1, name: '设定说明', content: 'stat_data 由 MVU 脚本维护，本条只是说明文字' }),
        baseEntry({ uid: 2, name: '另一段设定', content: 'safe' }),
      ],
    },
  ]);

  assert.equal(plan.groups.length, 1);
});

test('skips cases that could change original worldbook behavior', () => {
  const unsafeEntries = [
    baseEntry({ uid: 2, ignoreBudget: true }),
    baseEntry({ uid: 3, content: '@@depth 0\nDecorator' }),
    baseEntry({ uid: 4, position: position({ type: 'before_example_messages' }) }),
    baseEntry({ uid: 5, position: position({ type: 'outlet' }) }),
    baseEntry({ uid: 6, extra: { decorator: true } }),
    baseEntry({ uid: 7, triggers: ['manual'] }),
    baseEntry({ uid: 8, group: 'grouped' }),
    baseEntry({ uid: 9, characterFilter: { isExclude: false, names: ['Alice'], tags: [] } }),
    baseEntry({ uid: 10, effect: { sticky: null, cooldown: 3, delay: null } }),
    baseEntry({ uid: 11, recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: 1 } }),
    baseEntry({ uid: 12, content: '{{random::A::B}}' }),
  ];

  for (const unsafe of unsafeEntries) {
    const plan = createBlueEntryMergePlan(
      [{ name: 'Book A', entries: [unsafe, baseEntry({ uid: 99, content: 'safe' })] }],
      {
        detectRisks: entry => (entry.content.includes('{{random') ? [{ level: 'dynamic' }] : []),
      },
    );

    assert.equal(plan.groups.length, 0, `unexpected merge through uid ${unsafe.uid}`);
  }
});

function baseEntry(overrides = {}) {
  return {
    uid: overrides.uid ?? 1,
    name: overrides.name ?? `Entry ${overrides.uid ?? 1}`,
    enabled: overrides.enabled ?? true,
    strategy: {
      type: overrides.strategyType ?? 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: overrides.position ?? position(),
    content: overrides.content ?? `Content ${overrides.uid ?? 1}`,
    probability: overrides.probability ?? 100,
    recursion: overrides.recursion ?? { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
    effect: overrides.effect ?? { sticky: null, cooldown: null, delay: null },
    extra: overrides.extra,
    addMemo: true,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    group: overrides.group ?? '',
    groupOverride: false,
    groupWeight: 100,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    ignoreBudget: overrides.ignoreBudget ?? false,
    outletName: '',
    triggers: overrides.triggers ?? [],
    characterFilter: overrides.characterFilter ?? { isExclude: false, names: [], tags: [] },
  };
}

function position(overrides = {}) {
  return {
    type: overrides.type ?? 'before_character_definition',
    role: overrides.role ?? 'user',
    depth: overrides.depth ?? 0,
    order: overrides.order ?? 100,
  };
}
