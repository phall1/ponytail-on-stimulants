#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = require('../hooks/ponytail-on-stimulants-config');
const instructions = require('../hooks/ponytail-on-stimulants-instructions');

const root = path.join(__dirname, '..');

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ['CLAUDE_CONFIG_DIR', 'PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'QODER_SESSION_ID', 'CURSOR_VERSION', 'PONYTAIL_ON_STIMULANTS_DEFAULT_MODE', 'XDG_CONFIG_HOME']) delete env[key];
  return { ...env, ...extra };
}

function run(script, { env = {}, input = '', args = [] } = {}) {
  return spawnSync(process.execPath, [path.join(root, 'hooks', script), ...args], {
    env: cleanEnv(env), input, encoding: 'utf8', timeout: 10000,
  });
}

test('config accepts only canonical runtime modes', () => {
  assert.equal(config.normalizeMode('focused'), 'focused');
  assert.equal(config.normalizeMode('full-send'), 'full-send');
  assert.equal(config.normalizeMode('feral'), 'feral');
  assert.equal(config.normalizeMode('off'), 'off');
  assert.equal(config.normalizeMode('maximum'), null);
  assert.equal(config.normalizeMode('review'), null);
});

test('instruction builder filters mode-specific rows and uses fork identity', () => {
  const output = instructions.getPonytailInstructions('focused');
  assert.match(output, /^PONYTAIL ON STIMULANTS ACTIVE — mode: focused/);
  assert.match(output, /^\| \*\*focused\*\*/m);
  assert.doesNotMatch(output, /^\| \*\*full-send\*\*/m);
  assert.doesNotMatch(output, /^\| \*\*feral\*\*/m);
});

test('Claude activation writes fork-specific state and emits canonical default', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-hook-'));
  try {
    const result = run('ponytail-on-stimulants-activate.js', {
      env: { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'feral' },
      args: ['--reset'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);
    assert.equal(fs.readFileSync(path.join(home, '.claude', '.ponytail-on-stimulants-active'), 'utf8'), 'feral');
    assert.equal(fs.existsSync(path.join(home, '.claude', '.ponytail-active')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('off activation clears fork state and does not inject instructions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-off-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, '.ponytail-on-stimulants-active'), 'feral');
  try {
    const result = run('ponytail-on-stimulants-activate.js', {
      env: { HOME: home, CLAUDE_CONFIG_DIR: claude, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'off' },
      args: ['--reset'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'OK');
    assert.equal(fs.existsSync(path.join(claude, '.ponytail-on-stimulants-active')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('mode tracker persists canonical mode, reports status, and turns off', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-track-'));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
  try {
    let result = run('ponytail-on-stimulants-mode-tracker.js', { env, input: JSON.stringify({ prompt: '/ponytail-on-stimulants feral' }) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^PONYTAIL ON STIMULANTS MODE CHANGED — mode: feral/);
    assert.match(result.stdout, /^\| \*\*feral\*\*/m);
    const state = path.join(home, '.claude', '.ponytail-on-stimulants-active');
    assert.equal(fs.readFileSync(state, 'utf8'), 'feral');
    result = run('ponytail-on-stimulants-mode-tracker.js', { env, input: JSON.stringify({ prompt: '/ponytail-on-stimulants' }) });
    assert.equal(result.stdout, 'PONYTAIL ON STIMULANTS ACTIVE — mode: feral');
    result = run('ponytail-on-stimulants-mode-tracker.js', { env, input: JSON.stringify({ prompt: '/ponytail-on-stimulants off' }) });
    assert.equal(result.stdout, 'PONYTAIL ON STIMULANTS MODE OFF');
    assert.equal(fs.readFileSync(state, 'utf8'), 'off');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('resume activation preserves the selected mode and off state', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-resume-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  try {
    for (const mode of ['feral', 'off']) {
      fs.writeFileSync(path.join(claude, '.ponytail-on-stimulants-active'), mode);
      const result = run('ponytail-on-stimulants-activate.js', {
        env: { HOME: home, CLAUDE_CONFIG_DIR: claude, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'focused' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(claude, '.ponytail-on-stimulants-active'), 'utf8'), mode);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Qoder injects the rules on each prompt using its documented JSON shape', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-qoder-'));
  try {
    const result = run('ponytail-on-stimulants-mode-tracker.js', {
      env: { HOME: home, QODER_SESSION_ID: 'session', PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'focused' },
      input: JSON.stringify({ prompt: 'fix the parser' }),
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(output.hookSpecificOutput.additionalContext, /^PONYTAIL ON STIMULANTS ACTIVE — mode: focused/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Qoder off remains off on later prompts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-qoder-off-'));
  const env = { HOME: home, QODER_SESSION_ID: 'session', PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'focused' };
  try {
    let result = run('ponytail-on-stimulants-mode-tracker.js', {
      env,
      input: JSON.stringify({ prompt: '/ponytail-on-stimulants off' }),
    });
    assert.equal(result.status, 0, result.stderr);
    result = run('ponytail-on-stimulants-mode-tracker.js', {
      env,
      input: JSON.stringify({ prompt: 'fix the parser' }),
    });
    assert.equal(result.stdout, '');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('subagent hook inherits the active fork mode and respects its matcher', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-subagent-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, '.ponytail-on-stimulants-active'), 'feral');
  try {
    let result = run('ponytail-on-stimulants-subagent.js', {
      env: { HOME: home, CLAUDE_CONFIG_DIR: claude },
      input: JSON.stringify({ agent_type: 'general' }),
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
    assert.match(output.hookSpecificOutput.additionalContext, /^PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);

    result = run('ponytail-on-stimulants-subagent.js', {
      env: { HOME: home, CLAUDE_CONFIG_DIR: claude, PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER: '^explore$' },
      input: JSON.stringify({ agent_type: 'general' }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Claude/Codex hook config includes the shared Stop completion gate', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'claude-codex-hooks.json'), 'utf8'));
  assert.ok(Array.isArray(config.hooks.Stop) && config.hooks.Stop.length > 0);
  assert.ok(Array.isArray(config.hooks.PreToolUse) && config.hooks.PreToolUse.length > 0);
  assert.ok(Array.isArray(config.hooks.PostToolUseFailure) && config.hooks.PostToolUseFailure.length > 0);
  assert.equal(config.hooks.UserPromptSubmit[0].hooks.length, 2);
});

test('malformed hook input fails open', () => {
  const result = run('ponytail-on-stimulants-mode-tracker.js', { input: '{broken' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('Claude Stop hook continues with additionalContext after a mutation', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-gate-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, '.ponytail-on-stimulants-active'), 'full-send');
  const env = { HOME: home, CLAUDE_CONFIG_DIR: claude };
  try {
    let result = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 's1',
        prompt: 'Fix the parser bug in this repo',
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    result = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Edit',
        tool_input: { file_path: 'parser.js' },
        tool_use_id: 't1',
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    result = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 's1',
        tool_name: 'Edit',
        tool_input: { file_path: 'parser.js' },
        tool_use_id: 't1',
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    result = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 's1',
        cwd: home,
        last_assistant_message: 'Done.',
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'Stop');
    assert.match(output.hookSpecificOutput.additionalContext, /COMPLETION PASS 1\/1/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Codex Stop hook continues with decision block and does not reset on the continuation prompt', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-codex-gate-'));
  const data = path.join(home, 'plugin-data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, '.ponytail-on-stimulants-active'), 'full-send');
  const env = { HOME: home, PLUGIN_DATA: data };
  try {
    run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'c1',
        prompt: 'Fix the parser bug in this repo',
      }),
    });
    run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'c1',
        tool_name: 'apply_patch',
        tool_input: { patch: 'diff' },
        tool_use_id: 'p1',
      }),
    });
    const first = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'c1',
        cwd: home,
      }),
    });
    assert.equal(first.status, 0, first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /COMPLETION PASS 1\/1/);
    const reset = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'c1',
        prompt: output.reason,
      }),
    });
    assert.equal(reset.status, 0, reset.stderr);
    const second = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'c1',
        cwd: home,
      }),
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, '');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('focused mode does not emit a Stop continuation', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-focused-gate-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(path.join(claude, '.ponytail-on-stimulants-active'), 'focused');
  const env = { HOME: home, CLAUDE_CONFIG_DIR: claude };
  try {
    run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 's2',
        prompt: 'Fix the parser bug in this repo',
      }),
    });
    run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's2',
        tool_name: 'Write',
        tool_input: { file_path: 'a.js' },
      }),
    });
    const result = run('ponytail-on-stimulants-gate.js', {
      env,
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's2', cwd: home }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
