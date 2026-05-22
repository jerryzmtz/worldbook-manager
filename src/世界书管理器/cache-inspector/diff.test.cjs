const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node',
});
require('ts-node/register/transpile-only');

const { comparePromptRecords, createTextHash } = require('./diff.ts');

test('ignores empty assistant placeholders when finding the first useful prompt diff', () => {
  const before = snapshot([
    message('system', 'rules'),
    message('user', 'old user prompt'),
  ]);
  const after = snapshot([
    message('system', 'rules'),
    message('user', 'old user prompt'),
    message('assistant', ''),
    message('user', 'new user prompt with actual content'),
  ]);

  const result = comparePromptRecords(before, after);

  assert.equal(result.kind, 'message_added');
  assert.equal(result.index, 3);
  assert.equal(result.beforeIndex, null);
  assert.equal(result.afterIndex, 3);
  assert.equal(result.afterLength, 'new user prompt with actual content'.length);
  assert.match(result.context.afterChanged, /new user prompt/);
});

test('reports same effective prompt when only empty placeholders differ', () => {
  const before = snapshot([message('system', 'rules')]);
  const after = snapshot([message('system', 'rules'), message('assistant', '')]);

  const result = comparePromptRecords(before, after);

  assert.equal(result.kind, 'same');
  assert.equal(result.index, null);
  assert.equal(result.context, null);
  assert.match(result.summary, /空消息占位/);
});

test('keeps original indexes after filtering empty placeholders', () => {
  const before = snapshot([
    message('system', 'rules'),
    message('assistant', ''),
    message('user', 'same prompt'),
  ]);
  const after = snapshot([
    message('system', 'rules'),
    message('assistant', ''),
    message('user', 'changed prompt'),
  ]);

  const result = comparePromptRecords(before, after);

  assert.equal(result.kind, 'content_changed');
  assert.equal(result.index, 2);
  assert.equal(result.beforeIndex, 2);
  assert.equal(result.afterIndex, 2);
  assert.match(result.context.afterChanged, /changed/);
});

function snapshot(messages) {
  return {
    id: 'snapshot',
    timestamp: 1,
    messages,
  };
}

function message(role, text) {
  return {
    role,
    text,
    length: text.length,
    hash: createTextHash(text),
  };
}
