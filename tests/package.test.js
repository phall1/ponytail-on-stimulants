#!/usr/bin/env node
// The README tells users to run `node scripts/uninstall.js`, so the npm package
// must actually ship it. Guard the files entry so it can't silently drop out.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

test('npm package ships the advertised cleanup script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(
    pkg.files.includes('scripts/uninstall.js'),
    'package.json "files" must include scripts/uninstall.js (README tells users to run it)',
  );
  assert.match(
    fs.readFileSync(path.join(root, 'README.md'), 'utf8'),
    /node scripts\/uninstall\.js/,
    'README must document the cleanup command',
  );
  assert.ok(
    fs.existsSync(path.join(root, 'scripts', 'uninstall.js')),
    'scripts/uninstall.js is listed in files but missing on disk',
  );
});

test('npm artifact includes the Agent Plugins core and native runtimes but excludes tests', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = JSON.parse(result.stdout)[0].files.map((entry) => entry.path);
  for (const required of [
    'plugin.json',
    'mcp.json',
    'mcp/server.js',
    'skills/ponytail-on-stimulants/SKILL.md',
    'pi-extension/index.js',
    'completion-gate/index.js',
  ]) assert.ok(files.includes(required), `${required} missing from npm artifact`);
  assert.equal(files.some((file) => file.includes('/test/')), false);
  assert.equal(files.some((file) => file.startsWith('tests/')), false);
});
