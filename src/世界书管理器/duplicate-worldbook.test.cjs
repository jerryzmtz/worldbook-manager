const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const {
  createDuplicateWorldbookPlan,
  createDuplicateWorldbookRebindPlan,
  parseWorldbookVersionName,
} = require('./duplicate-worldbook.ts');

test('parses semantic versions, date versions, copy markers, and json extensions', () => {
  assert.deepEqual(pickNameInfo(parseWorldbookVersionName('角色世界书 v3.json')), {
    familyName: '角色世界书',
    normalizedFamilyName: '角色世界书',
    versionLabel: 'v3',
    versionKind: 'semantic',
    isCopy: false,
  });

  assert.deepEqual(pickNameInfo(parseWorldbookVersionName('角色世界书（0521）')), {
    familyName: '角色世界书',
    normalizedFamilyName: '角色世界书',
    versionLabel: '0521',
    versionKind: 'month_day',
    isCopy: false,
  });

  assert.deepEqual(pickNameInfo(parseWorldbookVersionName('角色世界书 2026-05-21')), {
    familyName: '角色世界书',
    normalizedFamilyName: '角色世界书',
    versionLabel: '2026-05-21',
    versionKind: 'full_date',
    isCopy: false,
  });

  assert.deepEqual(pickNameInfo(parseWorldbookVersionName('角色世界书 v2 copy')), {
    familyName: '角色世界书',
    normalizedFamilyName: '角色世界书',
    versionLabel: 'v2',
    versionKind: 'semantic',
    isCopy: true,
  });

  assert.deepEqual(pickNameInfo(parseWorldbookVersionName('角色世界书（副本）')), {
    familyName: '角色世界书',
    normalizedFamilyName: '角色世界书',
    versionLabel: null,
    versionKind: 'copy',
    isCopy: true,
  });
});

test('recommends the latest parsed version when an old book is covered by a newer book', () => {
  const plan = createDuplicateWorldbookPlan([
    {
      name: '神秘设定 v1',
      entries: [entry('A'), entry('B')],
    },
    {
      name: '神秘设定 v3',
      entries: [entry('A'), entry('B'), entry('C')],
    },
  ]);

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].keepCandidate.name, '神秘设定 v3');
  assert.deepEqual(
    plan.groups[0].deleteCandidates.map(candidate => candidate.name),
    ['神秘设定 v1'],
  );
  assert.equal(plan.groups[0].defaultSelected, true);
  assert.equal(plan.summary.defaultDeleteBooks, 1);
});

test('does not group similar names when the contents are unrelated', () => {
  const plan = createDuplicateWorldbookPlan([
    {
      name: '城市设定 0511',
      entries: [entry('A', '旧城市规则')],
    },
    {
      name: '城市设定 0521',
      entries: [entry('B', '完全不同的新版世界观')],
    },
  ]);

  assert.equal(plan.groups.length, 0);
});

test('marks low-confidence groups as visible but not selected by default', () => {
  const plan = createDuplicateWorldbookPlan(
    [
      {
        name: '战斗规则 v1',
        entries: [entry('A'), entry('B'), entry('C')],
      },
      {
        name: '战斗规则 v2',
        entries: [entry('A'), entry('D'), entry('E')],
      },
    ],
    {},
    { lowConfidenceSimilarity: 0.3, lowConfidenceCoverage: 0.3 },
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].confidence, 'low');
  assert.equal(plan.groups[0].defaultSelected, false);
});

test('creates rebind plans for global, character, additional, and chat bindings', () => {
  const plan = createDuplicateWorldbookRebindPlan(['旧书 v1', '旧书 v2'], '旧书 v3', {
    globalNames: ['公共书', '旧书 v1'],
    charWorldbooks: {
      primary: '旧书 v2',
      additional: ['附加书', '旧书 v1', '旧书 v3'],
    },
    chatName: '旧书 v1',
  });

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.sources, ['chat', 'character_primary', 'character_additional', 'global']);
  assert.deepEqual(plan.globalNames, ['公共书', '旧书 v3']);
  assert.deepEqual(plan.charWorldbooks, {
    primary: '旧书 v3',
    additional: ['附加书'],
  });
  assert.equal(plan.chatName, '旧书 v3');
});

function pickNameInfo(info) {
  return {
    familyName: info.familyName,
    normalizedFamilyName: info.normalizedFamilyName,
    versionLabel: info.versionLabel,
    versionKind: info.versionKind,
    isCopy: info.isCopy,
  };
}

function entry(name, content = name) {
  return {
    name,
    enabled: true,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: {
      type: 'before_character_definition',
      role: 'system',
      depth: 0,
      order: 100,
    },
    content,
    probability: 100,
    recursion: {
      prevent_incoming: false,
      prevent_outgoing: false,
      delay_until: null,
    },
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
  };
}
