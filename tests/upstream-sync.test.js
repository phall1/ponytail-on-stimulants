#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('upstream sync policy records the canonical source and fork-owned conflict surfaces', () => {
  const policy = read('UPSTREAM.md');
  assert.match(policy, /github\.com\/DietrichGebert\/ponytail/);
  assert.match(policy, /Last reconciled commit: `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`/);
  assert.match(policy, /Intentionally fork-owned conflict surfaces/);
  assert.match(policy, /completion-gate/);
  assert.match(policy, /never accept upstream prompt semantics blindly/i);
});

test('local sync check is disposable and refuses a dirty worktree', () => {
  const script = read('scripts/sync-upstream.sh');
  assert.match(script, /status --porcelain/);
  assert.match(script, /worktree add --detach/);
  assert.match(script, /worktree remove --force/);
  assert.match(script, /git merge --no-commit --no-ff upstream\/main/);
});

test('scheduled sync validates and opens review without auto-merge', () => {
  const workflow = read('.github/workflows/upstream-sync.yml');
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /Last reconciled version/);
  assert.match(workflow, /HEAD\^\{tree\}.*origin\/\$\{branch\}\^\{tree\}/);
  assert.match(workflow, /clean == 'true' \|\| steps\.merge\.outputs\.clean == 'existing'/);
  assert.match(workflow, /gh pr create/);
  assert.doesNotMatch(workflow, /gh pr merge|--auto/);
});
