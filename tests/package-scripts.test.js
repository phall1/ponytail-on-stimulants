#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('root npm test covers root tests and the bundled Pi adapter', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.test, /node --import \.\/tests\/isolate-recaps\.cjs --test tests\/\*\.test\.js/);
  assert.match(packageJson.scripts.test, /npm test --prefix pi-extension/);
});

test('every test entry point isolates recaps from the real index', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const pi = JSON.parse(fs.readFileSync(path.join(root, 'pi-extension', 'package.json'), 'utf8')).scripts;
  for (const script of [scripts['test:completion'], pi.test]) {
    for (const command of script.split('&&')) assert.match(command, /node --import \S*isolate-recaps\.cjs /);
  }
});

test('CI runs the dependency-free MCP tests without a nested install', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8');
  assert.doesNotMatch(workflow, /npm install --prefix/);
  assert.match(workflow, /npm test/);
  assert.ok(fs.existsSync(path.join(root, 'tests', 'mcp-artifact.test.js')));
});
