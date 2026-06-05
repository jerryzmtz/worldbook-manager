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
        entries: [entry('A'), entry('B'), entry('D')],
      },
    ],
    {},
    { lowConfidenceSimilarity: 0.3, lowConfidenceCoverage: 0.3 },
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].confidence, 'low');
  assert.equal(plan.groups[0].defaultSelected, false);
});

test('keeps conservative mode inside the same parsed name family', () => {
  const sharedEntries = [entry('设定', longContent('同一个角色世界书正文'))];
  const plan = createDuplicateWorldbookPlan(
    [
      {
        name: '旧角色世界书 v1',
        entries: sharedEntries,
      },
      {
        name: '新角色世界书 v2',
        entries: sharedEntries,
      },
    ],
    {},
    { strategy: 'conservative' },
  );

  assert.equal(plan.groups.length, 0);
});

test('balanced mode detects renamed worldbooks with overlapping entry content', () => {
  const plan = createDuplicateWorldbookPlan(
    [
      {
        name: '角色世界书 v1',
        entries: [entry('身份', longContent('身份设定')), entry('住处', longContent('住处设定'))],
      },
      {
        name: '角色卡新版附带世界书 2026-05-30',
        entries: [
          entry('身份新版', `${longContent('身份设定')}\n补充一句新版细节。`),
          entry('住处新版', longContent('住处设定')),
          entry('新增关系', longContent('新增关系')),
        ],
      },
    ],
    {},
    { strategy: 'balanced' },
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].crossFamily, true);
  assert.equal(plan.groups[0].keepCandidate.name, '角色卡新版附带世界书 2026-05-30');
  assert.equal(plan.groups[0].defaultSelected, true);
  assert.ok(plan.groups[0].deleteCandidates[0].contentCoverageByKeep >= 0.82);
});

test('balanced mode matches content even when keys and positions changed', () => {
  const oldEntry = entry('旧条目', longContent('地点设定'));
  const newEntry = entry('新版条目', `${longContent('地点设定')}\n新版本补充信息。`);
  newEntry.strategy.keys = ['完全不同的触发词'];
  newEntry.position.order = 999;
  newEntry.position.depth = 4;

  const plan = createDuplicateWorldbookPlan(
    [
      {
        name: '地点世界书 v1',
        entries: [oldEntry],
      },
      {
        name: '地点世界书 v2',
        entries: [newEntry],
      },
    ],
    {},
    { strategy: 'balanced' },
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].confidence, 'high');
});

test('aggressive mode accepts lower coverage and selects it by default', () => {
  const plan = createDuplicateWorldbookPlan(
    [
      {
        name: '资料集 v1',
        entries: [entry('A', longContent('A')), entry('B', longContent('B')), entry('C', longContent('C'))],
      },
      {
        name: '资料集 v2',
        entries: [entry('A2', longContent('A')), entry('B2', longContent('B')), entry('D', longContent('D'))],
      },
    ],
    {},
    { strategy: 'aggressive' },
  );

  assert.equal(plan.groups.length, 1);
  assert.notEqual(plan.groups[0].confidence, 'exact');
  assert.equal(plan.groups[0].defaultSelected, true);
});

test('falls back to modified time and content size when versions are unclear', () => {
  const plan = createDuplicateWorldbookPlan(
    [
      {
        name: '无版本角色书 旧',
        modifiedAt: 100,
        entries: [entry('A', longContent('A'))],
      },
      {
        name: '无版本角色书 新',
        modifiedAt: 200,
        entries: [entry('A2', longContent('A')), entry('B', longContent('B'))],
      },
    ],
    {},
    { strategy: 'balanced' },
  );

  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].keepCandidate.name, '无版本角色书 新');
});

test('creates rebind plans for global, character, all character main bindings, and chat bindings', () => {
  const plan = createDuplicateWorldbookRebindPlan(['旧书 v1', '旧书 v2'], '旧书 v3', {
    globalNames: ['公共书', '旧书 v1'],
    charWorldbooks: {
      primary: '旧书 v2',
      additional: ['附加书', '旧书 v1', '旧书 v3'],
    },
    chatName: '旧书 v1',
    allCharacterWorldbooks: [
      { characterName: '角色A', worldbook: '旧书 v1' },
      { characterName: '角色B', worldbook: '其他书' },
      { characterName: '角色C', worldbook: '旧书 v2' },
    ],
  });

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.sources, ['chat', 'character_primary', 'character_additional', 'character_all', 'global']);
  assert.deepEqual(plan.globalNames, ['公共书', '旧书 v3']);
  assert.deepEqual(plan.charWorldbooks, {
    primary: '旧书 v3',
    additional: ['附加书'],
  });
  assert.equal(plan.chatName, '旧书 v3');
  assert.deepEqual(plan.characterUpdates, [
    { characterName: '角色A', worldbook: '旧书 v3' },
    { characterName: '角色C', worldbook: '旧书 v3' },
  ]);
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

function longContent(label) {
  return `${label}${label}${label}：这是一段足够长的世界书条目正文，专门记录${label}相关的独有设定。${label}会影响人物关系、场景规则、长期记忆和触发条件。`;
}
