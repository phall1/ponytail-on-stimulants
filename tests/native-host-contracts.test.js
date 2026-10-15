'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadTurnState, turnStatePath } = require('../completion-gate/persist');
const root = path.resolve(__dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('Codex native overlay selects supported events and restores forked sessions', () => {
  const manifest = read('.codex-plugin/plugin.json');
  assert.equal(manifest.hooks, './hooks/codex-hooks.json');
  const config = read(manifest.hooks);
  assert.equal(config.hooks.PostToolUseFailure, undefined);
  assert.ok(config.hooks.SessionStart.some((entry) => entry.matcher.split('|').includes('fork')));
  assert.ok(read('hooks/claude-codex-hooks.json').hooks.PostToolUseFailure, 'Claude keeps its supported failure event');
  for (const name of ['PreToolUse', 'PostToolUse', 'Stop']) assert.ok(config.hooks[name]);
});

test('Codex observed tool results remain unknown, not false verification success', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stimulants-codex-outcomes-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, CLAUDE_CONFIG_DIR: home, PLUGIN_DATA: home };
  for (const key of ['COPILOT_PLUGIN_DATA', 'CURSOR_VERSION', 'QODER_SESSION_ID', 'QODER_PLUGIN_ROOT', 'QODER_PLUGIN_DATA']) delete env[key];
  function event(data) {
    const result = spawnSync(process.execPath, [path.join(root, 'hooks/ponytail-on-stimulants-gate.js')], {
      env, input: JSON.stringify({ session_id: 's', ...data }), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  event({ hook_event_name: 'UserPromptSubmit', prompt: 'Run the tests' });
  for (const [id, response] of [['empty-success', ''], ['quiet-failure', { output: '' }]]) {
    event({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'npm test' } });
    event({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: id, tool_response: response });
  }
  const state = loadTurnState(turnStatePath(home, 's'));
  assert.deepEqual(state.recentTools.map((item) => item.status), ['unknown', 'unknown']);
  const switched = spawnSync(process.execPath, [path.join(root, 'hooks/ponytail-on-stimulants-mode-tracker.js')], {
    env, input: JSON.stringify({ prompt: '$ponytail-on-stimulants:ponytail-on-stimulants feral' }), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(fs.readFileSync(path.join(home, '.ponytail-on-stimulants-active'), 'utf8'), 'feral');
  assert.match(JSON.parse(switched.stdout).hookSpecificOutput.additionalContext, /mode: feral/);
});

test('uninstall regression suite never consumes ambient user-state paths', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stimulants-uninstall-ambient-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env };
  const sentinels = [];
  for (const key of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'QODER_CONFIG_DIR']) {
    const directory = path.join(temp, key);
    fs.mkdirSync(directory, { recursive: true });
    env[key] = directory;
    const file = path.join(directory, '.ponytail-on-stimulants-active');
    fs.writeFileSync(file, 'sentinel');
    sentinels.push(file);
  }
  const result = spawnSync(process.execPath, [path.join(root, 'tests/uninstall.test.js')], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  for (const file of sentinels) assert.equal(fs.readFileSync(file, 'utf8'), 'sentinel');
});

test('Windsurf workspace rule explicitly opts into always-on activation', () => {
  assert.match(fs.readFileSync(path.join(root, '.windsurf/rules/ponytail-on-stimulants.md'), 'utf8'), /^---\ntrigger: always_on\n---/);
});
