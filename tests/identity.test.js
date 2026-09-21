#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ignored = new Set(['.git', 'node_modules', 'results']);

function files(directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

test('public manifests use only the fork package identity', () => {
  for (const relative of [
    'package.json', 'plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
    '.devin-plugin/plugin.json', '.github/plugin/plugin.json', '.qoder-plugin/plugin.json',
    '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json',
    '.github/plugin/marketplace.json', '.grok-plugin/marketplace.json',
    'gemini-extension.json',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    assert.equal(manifest.name, 'ponytail-on-stimulants', relative);
    for (const plugin of manifest.plugins || []) {
      assert.equal(plugin.name, 'ponytail-on-stimulants', `${relative} plugin identity`);
    }
  }
  assert.match(
    fs.readFileSync(path.join(root, 'plugin.yaml'), 'utf8'),
    /^name:\s*ponytail-on-stimulants\s*$/m,
  );
});

test('active source contains no duplicated fork name or upstream runtime namespace', () => {
  const active = files().filter((file) => file !== __filename && !file.includes(`${path.sep}benchmarks${path.sep}results${path.sep}`));
  for (const file of active) {
    if (['LICENSE', 'CHANGELOG.md'].includes(path.basename(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /ponytail-on-stimulants-on-stimulants/i, file);
    assert.doesNotMatch(text, /process\.env\.PONYTAIL_(?!ON_STIMULANTS)/, file);
  }
});

test('removed shadow configuration and nested MCP package stay absent', () => {
  assert.equal(fs.existsSync(path.join(root, 'opencode.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'ponytail-on-stimulants-mcp')), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./plugin'], undefined);
});

test('fork runtime paths are distinct from upstream Ponytail', () => {
  const config = fs.readFileSync(path.join(root, 'hooks', 'ponytail-on-stimulants-config.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'hooks', 'ponytail-on-stimulants-runtime.js'), 'utf8');
  const uninstall = fs.readFileSync(path.join(root, 'scripts', 'uninstall.js'), 'utf8');
  assert.match(config, /ponytail-on-stimulants/);
  assert.match(runtime, /\.ponytail-on-stimulants-active/);
  assert.doesNotMatch(uninstall, /ponytail-\[\\w-\]/, 'uninstall must not use a broad upstream-matching hook pattern');
});
