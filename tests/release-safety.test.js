#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function checkVersion(refName) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'check-versions.js')], {
    cwd: root,
    env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: refName },
    encoding: 'utf8',
  });
}

test('release tag must match the pinned fork version exactly', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert.equal(checkVersion(`v${version}`).status, 0);
  const mismatch = checkVersion(`v${version}-unexpected`);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, new RegExp(`release tag must be exactly v${version.replace(/\./g, '\\.')}\\b`));
});

test('publish waits for validation and cannot run from manual dispatch', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.match(workflow, /push:\s*\n\s*tags:/);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.match(workflow, /publish:\s*\n\s*needs: validate/);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(workflow, /npm pack --dry-run/);
  assert.match(workflow, /benchmarks\/agentic\/run\.py --selftest/);
  assert.match(workflow, /benchmarks\/agentic\/complete\.py --selftest-offline/);
  assert.match(workflow, /npm-package/);
  assert.match(workflow, /npm publish artifact\/ponytail-on-stimulants-\*\.tgz/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@(v\d+|main|master)\b/);
  assert.doesNotMatch(workflow, /npm@latest/);
  const publishJob = workflow.slice(workflow.indexOf('\n  publish:'));
  assert.match(publishJob, /permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('\njobs:')), /id-token: write/);
});
