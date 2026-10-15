#!/usr/bin/env node
// Every ponytail-on-stimulants command the pi extension registers must also ship as a
// file-based command for the hosts that need one: Claude Code (commands/*.toml,
// which Gemini CLI reuses) and OpenCode (.opencode/command/*.md). /ponytail-on-stimulants-help
// was advertised in the README and the help card but missing both files; this
// guards that drift -- a registered command with no adapter file fails here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// The runtime registration itself is exercised in pi-extension/test/extension.test.js.
const commands = [
  'ponytail-on-stimulants',
  'ponytail-on-stimulants-review',
  'ponytail-on-stimulants-audit',
  'ponytail-on-stimulants-debt',
  'ponytail-on-stimulants-gain',
  'ponytail-on-stimulants-help',
];

test('debt command adapters honor ignore rules and block comments', () => {
  for (const file of ['commands/ponytail-on-stimulants-debt.toml', '.opencode/command/ponytail-on-stimulants-debt.md']) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(content, /--untracked --exclude-standard/);
    assert.match(content, /line and block comments/);
    assert.doesNotMatch(content, /grep -rnE/);
  }
});

test('pi registers at least the base command', () => {
  assert.ok(commands.includes('ponytail-on-stimulants'), 'expected pi to register a ponytail-on-stimulants command');
});

test('every registered command ships a Claude commands/*.toml', () => {
  for (const name of commands) {
    assert.ok(
      fs.existsSync(path.join(root, 'commands', `${name}.toml`)),
      `missing commands/${name}.toml`,
    );
  }
});

test('every registered command ships an OpenCode .opencode/command/*.md', () => {
  for (const name of commands) {
    assert.ok(
      fs.existsSync(path.join(root, '.opencode', 'command', `${name}.md`)),
      `missing .opencode/command/${name}.md`,
    );
  }
});
