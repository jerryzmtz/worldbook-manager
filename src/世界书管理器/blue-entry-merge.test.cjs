const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const { createBlueEntryMergePlan } = require('./blue-entry-merge.ts');

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
  assert.equal(group.mergedEntry.uid, 3);
  assert.equal(bookPlan.entries.length, 1);
  assert.equal(bookPlan.entries[0].uid, 3);
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
    [1, 2, 5],
  );
});

test('assigns stable unique UIDs when one book has multiple merge groups', () => {
  const entries = [
    baseEntry({ uid: 2, content: 'before 1', position: position({ type: 'before_character_definition', order: 10 }) }),
    baseEntry({ uid: 4, content: 'before 2', position: position({ type: 'before_character_definition', order: 20 }) }),
    baseEntry({ uid: 6, content: 'after 1', position: position({ type: 'after_author_note', order: 10 }) }),
    baseEntry({ uid: 8, content: 'after 2', position: position({ type: 'after_author_note', order: 20 }) }),
  ];

  const plan = createBlueEntryMergePlan([{ name: 'Book A', entries }]);

  assert.deepEqual(
    plan.groups.map(group => group.mergedEntry.uid),
    [9, 10],
  );
  assert.deepEqual(
    plan.books[0].entries.map(entry => entry.uid),
    [9, 10],
  );
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
