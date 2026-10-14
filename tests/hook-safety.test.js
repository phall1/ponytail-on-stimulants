'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { getPonytailInstructions } = require('../hooks/ponytail-on-stimulants-instructions');
const { createTurnState } = require('../completion-gate');
const { loadTurnState, saveTurnState, turnStatePath } = require('../completion-gate/persist');

const root = path.join(__dirname, '..');
const stateFile = '.ponytail-on-stimulants-active';
const activate = path.join(root, 'hooks/ponytail-on-stimulants-activate.js');
const gate = path.join(root, 'hooks/ponytail-on-stimulants-gate.js');
const tracker = path.join(root, 'hooks/ponytail-on-stimulants-mode-tracker.js');
const subagent = path.join(root, 'hooks/ponytail-on-stimulants-subagent.js');
const runtime = path.join(root, 'hooks/ponytail-on-stimulants-runtime.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-hook-safety-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const claude = path.join(dir, '.claude');
  const copilot = path.join(dir, 'copilot-data');
  const codex = path.join(dir, 'codex-data');
  for (const stateDir of [claude, copilot, codex, path.join(dir, '.qoder')]) {
    fs.mkdirSync(stateDir);
    fs.writeFileSync(path.join(stateDir, stateFile), 'feral');
  }
  const env = { ...process.env };
  for (const key of [
    'CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT', 'QODER_PLUGIN_ROOT', 'CLAUDE_CONFIG_DIR',
    'PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'QODER_SESSION_ID', 'QODER_CONFIG_DIR', 'CURSOR_VERSION',
    'CURSOR_PROJECT_DIR', 'PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER',
    'PONYTAIL_ON_STIMULANTS_DEFAULT_MODE', 'XDG_CONFIG_HOME',
  ]) delete env[key];
  Object.assign(env, {
    HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: claude,
    PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'focused',
  });
  return { dir, claude, copilot, codex, env };
}

function launchers() {
  const commands = [];
  for (const [name, envKey] of [
    ['claude-codex', 'CLAUDE_PLUGIN_ROOT'],
    ['copilot', 'PLUGIN_ROOT'],
    ['qoder', 'QODER_PLUGIN_ROOT'],
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `hooks/${name}-hooks.json`), 'utf8'));
    for (const [event, entries] of Object.entries(manifest.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks || [entry]) {
          for (const field of ['command', 'bash', 'powershell']) {
            if (hook[field]) commands.push({ name, envKey, event, field, command: hook[field] });
          }
        }
      }
    }
  }
  return commands;
}

function checked(result, label = '') {
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.stderr, '', label);
  return result.stdout;
}

function run(script, env, input = '', args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    env, input, encoding: 'utf8', timeout: 4000, maxBuffer: 8 * 1024 * 1024,
  });
}

function shellRun(command, env, cwd, input = '') {
  return spawnSync('/bin/sh', ['-c', command], {
    env, cwd, input, encoding: 'utf8', timeout: 4000,
  });
}

test('all fork launchers keep plugin roots out of shell text, including gate and Qoder', () => {
  const commands = launchers();
  assert.equal(commands.filter(c => c.event === 'Stop').length, 1);
  for (const { command, envKey, field } of commands) {
    assert.doesNotMatch(command, /\$\{(?:CLAUDE_|QODER_)?PLUGIN_ROOT\}|PONYTAIL_ON_STIMULANTS_DIR/);
    assert.ok(command.includes(`process.env.${envKey}.split(String.fromCharCode(92)).join('/')`));
    // Keep upstream's Node 12-compatible path loader, not replaceAll/node:path.
    assert.ok(command.includes("require('path')"));
    assert.doesNotMatch(command, /replaceAll|node:path/);
    const script = command.match(/hooks\/([\w-]+\.js)/);
    assert.ok(script, command);
    assert.ok(fs.existsSync(path.join(root, 'hooks', script[1])));
    if (field === 'command') {
      assert.match(command, /^node -e /);
      assert.doesNotMatch(command, /\bexec\s|&&|\|\||command -v/);
    }
  }
});

test('launchers load real hooks with backslashed roots without a shell', t => {
  const f = fixture(t);
  for (const launcher of launchers()) {
    const { command, envKey, name, event } = launcher;
    const code = command.match(/node -e "([^"]+)"/)[1];
    const env = { ...f.env, [envKey]: root.split(path.sep).join('\\') };
    if (name === 'copilot') env.COPILOT_PLUGIN_DATA = f.copilot;
    if (name === 'qoder') env.QODER_SESSION_ID = 'safety';
    // Restore feral before each activation to prove --reset is still forwarded.
    fs.writeFileSync(path.join(name === 'copilot' ? f.copilot : f.claude, stateFile), 'feral');
    const args = ['-e', code, ...(command.includes('--reset') ? ['--', '--reset'] : [])];
    const result = spawnSync(process.execPath, args, {
      env, input: JSON.stringify({ prompt: '/ponytail-on-stimulants status', agent_type: 'general' }),
      encoding: 'utf8', timeout: 4000,
    });
    checked(result, command);
    if (event === 'SessionStart' || event === 'sessionStart') {
      assert.match(result.stdout, new RegExp(`mode: ${command.includes('--reset') ? 'focused' : 'feral'}`));
    }
  }
});

test('host textual substitution cannot execute dollars, backticks, or quotes in real install roots', {
  skip: process.platform === 'win32' && 'requires a POSIX shell',
}, t => {
  const f = fixture(t);
  const hostileRoot = path.join(f.dir, 'root $(touch DOLLAR_MARKER) `touch BACKTICK_MARKER` "\'; touch QUOTE_MARKER; #');
  fs.symlinkSync(root, hostileRoot, 'dir');
  for (const { command, envKey, name, field } of launchers()) {
    if (field === 'powershell') continue;
    const substituted = command.replace(/\$\{(?:CLAUDE_|QODER_)?PLUGIN_ROOT\}/g, hostileRoot);
    const env = { ...f.env, [envKey]: hostileRoot };
    if (name === 'copilot') env.COPILOT_PLUGIN_DATA = f.copilot;
    if (name === 'qoder') env.QODER_SESSION_ID = 'safety';
    checked(shellRun(substituted, env, f.dir, JSON.stringify({ prompt: 'hello', agent_type: 'general' })), command);
    for (const marker of ['DOLLAR_MARKER', 'BACKTICK_MARKER', 'QUOTE_MARKER']) {
      assert.equal(fs.existsSync(path.join(f.dir, marker)), false, command);
    }
  }
});

test('Copilot POSIX launcher tolerates missing Node but shared Stop preserves failures', {
  skip: process.platform === 'win32' && 'requires a POSIX shell',
}, t => {
  const f = fixture(t);
  for (const launcher of launchers()) {
    if (launcher.field === 'bash') {
      const result = shellRun(launcher.command, { ...f.env, PATH: '', PLUGIN_ROOT: root }, f.dir);
      assert.equal(result.status, 0, result.stderr);
    } else if (launcher.event === 'Stop') {
      const result = shellRun(launcher.command, { ...f.env, PATH: '', CLAUDE_PLUGIN_ROOT: root }, f.dir);
      assert.notEqual(result.status, 0, 'Stop must not blanket-mask failures');
    }
    if (launcher.field === 'powershell') assert.match(launcher.command, /^if \(Get-Command node -ErrorAction SilentlyContinue\)/);
  }
});

test('gate launcher preserves Claude and Codex Stop continuation protocols', t => {
  const f = fixture(t);
  const launcher = launchers().find(c => c.event === 'Stop');
  const code = launcher.command.match(/node -e "([^"]+)"/)[1];
  for (const host of ['claude', 'codex']) {
    const stateDir = host === 'codex' ? f.codex : f.claude;
    fs.writeFileSync(path.join(stateDir, stateFile), 'full-send');
    const env = { ...f.env, CLAUDE_PLUGIN_ROOT: root, ...(host === 'codex' ? { PLUGIN_DATA: f.codex } : {}) };
    const send = data => checked(spawnSync(process.execPath, ['-e', code], {
      env, input: JSON.stringify({ session_id: host, ...data }), encoding: 'utf8', timeout: 4000,
    }));
    send({ hook_event_name: 'UserPromptSubmit', prompt: 'Fix the parser bug' });
    send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'parser.js' } });
    const output = JSON.parse(send({ hook_event_name: 'Stop', cwd: f.dir }));
    if (host === 'codex') {
      assert.equal(output.decision, 'block');
      assert.match(output.reason, /COMPLETION PASS 1\/1/);
    } else {
      assert.equal(output.hookSpecificOutput.hookEventName, 'Stop');
      assert.match(output.hookSpecificOutput.additionalContext, /COMPLETION PASS 1\/1/);
    }
  }
});

function openStdin(script, env, input, unrefStdin) {
  return new Promise((resolve, reject) => {
    const code = `require(${JSON.stringify(script)});${unrefStdin ? 'process.stdin.unref();' : ''}`;
    const child = spawn(process.execPath, ['-e', code], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('stdin fallback did not fire')); }, 3500);
    child.on('error', error => { clearTimeout(guard); reject(error); });
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('close', (status, signal) => {
      clearTimeout(guard);
      child.stdin.destroy();
      resolve({ status, signal, stdout, stderr, elapsed: Date.now() - started });
    });
    child.stdin.on('error', () => {});
    if (input) child.stdin.write(input); // Deliberately never send EOF.
  });
}

test('referenced stdin fallback actually fires with open or unreferenced stdin', async t => {
  const f = fixture(t);
  const env = { ...f.env, PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER: '^general$' };
  for (const unrefStdin of [false, true]) {
    for (const script of [tracker, subagent]) {
      const result = await openStdin(script, env, '', unrefStdin);
      checked(result, script);
      assert.equal(result.signal, null);
      assert.ok(result.elapsed >= 900 && result.elapsed < 3000, `${script}: ${result.elapsed}ms`);
      if (script === subagent) assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /mode: feral/);
      else assert.equal(result.stdout, '');
    }
  }
  const partial = await openStdin(tracker, env, JSON.stringify({ prompt: '/ponytail-on-stimulants focused' }), false);
  assert.match(checked(partial), /MODE CHANGED — mode: focused/);
  assert.equal(fs.readFileSync(path.join(f.claude, stateFile), 'utf8'), 'focused');
});

test('EOF path and matcher-free subagent do not wait for the referenced fallback', async t => {
  const f = fixture(t);
  for (const script of [tracker, subagent]) {
    const start = Date.now();
    checked(run(script, { ...f.env, PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER: '^general$' }, JSON.stringify({ agent_type: 'general', prompt: 'hello' })));
    assert.ok(Date.now() - start < 800, 'EOF path waited for fallback');
  }
  const result = await openStdin(subagent, f.env, '', false);
  assert.match(checked(result), /SubagentStart/);
  assert.ok(result.elapsed < 800, 'default subagent path waited on stdin');
});

test('pathological user matcher is bounded and fails open without a shell', t => {
  const f = fixture(t);
  const context = getPonytailInstructions('feral');
  for (const [matcher, agentType, inject] of [
    ['(a+)+$', 'a'.repeat(40) + '!', true],
    ['^general$', 'GENERAL', true],
    ['^general$', 'explore', false],
    ['[', 'general', true],
    ['^general$', '', true],
  ]) {
    const start = Date.now();
    const output = checked(run(subagent, { ...f.env, PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER: matcher }, JSON.stringify({ agent_type: agentType })));
    assert.ok(Date.now() - start < 1500, `${matcher} exceeded its time box`);
    if (inject) assert.equal(JSON.parse(output).hookSpecificOutput.additionalContext, context);
    else assert.equal(output, '');
  }
  const malformed = checked(run(subagent, { ...f.env, PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER: '^general$' }, '{broken'));
  assert.equal(JSON.parse(malformed).hookSpecificOutput.additionalContext, context);
});

test('synchronous stdout survives immediate exit through a pipe for every runtime output form', t => {
  const f = fixture(t);
  const context = 'héllo $ ` " \\ 🐴\n'.repeat(40000);
  for (const [host, extra] of [
    ['claude', {}], ['codex', { PLUGIN_DATA: f.codex }],
    ['copilot', { COPILOT_PLUGIN_DATA: f.copilot }], ['qoder', { QODER_SESSION_ID: 'safety' }],
    ['cursor', { CURSOR_VERSION: 'safety' }],
  ]) {
    const env = { ...f.env, ...extra };
    for (const event of ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'Stop']) {
      const code = `const r = require(${JSON.stringify(runtime)}); const s = ${JSON.stringify('héllo $ ` " \\ 🐴\n')}.repeat(40000); r.${event === 'Stop' ? 'writeStopContinuation' : 'writeHookOutput'}(${JSON.stringify(event)}, ${event === 'Stop' ? 's' : "'feral', s"}); process.exit(0);`;
      const result = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 4000, maxBuffer: 8 * 1024 * 1024 });
      const output = checked(result, `${host}/${event}`);
      if (host === 'claude' && event !== 'SubagentStart' && event !== 'Stop') assert.equal(output, context);
      else {
        const parsed = JSON.parse(output);
        if (host === 'codex') assert.equal(parsed.systemMessage, undefined);
        const actual = event === 'Stop' && host === 'codex' ? parsed.reason :
          event !== 'Stop' && host === 'copilot' ? parsed.additionalContext :
          event !== 'Stop' && host === 'cursor' ? parsed.additional_context : parsed.hookSpecificOutput.additionalContext;
        assert.equal(actual, context, `${host}/${event} output was truncated`);
      }
    }
  }
});

test('startup mode reset preserves other sessions and their exhausted continuation caps', t => {
  const f = fixture(t);
  for (const [stateDir, hostEnv] of [[f.claude, {}], [f.codex, { PLUGIN_DATA: f.codex }]]) {
    for (const [mode, cap] of [['full-send', 1], ['feral', 2]]) {
      const env = { ...f.env, ...hostEnv, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: mode };
      const sessions = ['starting-session', 'other-session'];
      const snapshots = new Map();
      for (const session of sessions) {
        const file = turnStatePath(stateDir, session);
        saveTurnState(file, { ...createTurnState('Fix the parser'), hadMutation: true, continuations: cap });
        snapshots.set(file, fs.readFileSync(file, 'utf8'));
      }
      checked(run(activate, env, '', ['--reset']));
      for (const [file, snapshot] of snapshots) assert.equal(fs.readFileSync(file, 'utf8'), snapshot);
      // Another session remains capped even after a fresh session startup.
      const stop = checked(run(gate, env, JSON.stringify({
        hook_event_name: 'Stop', session_id: 'other-session', cwd: f.dir,
      })));
      assert.equal(stop, '', `${mode} startup reset revived an exhausted continuation`);
      assert.equal(loadTurnState(turnStatePath(stateDir, 'other-session')).continuations, cap);
      // Only the real human prompt resets its own session's turn state.
      checked(run(gate, env, JSON.stringify({
        hook_event_name: 'UserPromptSubmit', session_id: 'starting-session', prompt: 'Fix the next parser bug',
      })));
      assert.equal(loadTurnState(turnStatePath(stateDir, 'starting-session')).continuations, 0);
      assert.equal(loadTurnState(turnStatePath(stateDir, 'other-session')).continuations, cap);
    }
  }
});

test('off activation is silent for every host and preserves turn state', t => {
  const f = fixture(t);
  const qoder = path.join(f.dir, '.qoder');
  const cursor = path.join(f.dir, '.cursor');
  fs.mkdirSync(cursor);
  for (const [stateDir, extra] of [
    [f.claude, {}], [f.codex, { PLUGIN_DATA: f.codex }],
    [f.copilot, { COPILOT_PLUGIN_DATA: f.copilot }], [qoder, { QODER_SESSION_ID: 'safety' }],
    [cursor, { CURSOR_VERSION: 'safety' }],
  ]) {
    const file = turnStatePath(stateDir, 'other-session');
    saveTurnState(file, { ...createTurnState('Fix a bug'), continuations: 1 });
    const snapshot = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(path.join(stateDir, stateFile), 'feral');
    const env = { ...f.env, ...extra, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'off' };
    assert.equal(checked(run(activate, env, '', ['--reset'])), '');
    assert.equal(fs.existsSync(path.join(stateDir, stateFile)), false);
    assert.equal(fs.readFileSync(file, 'utf8'), snapshot);
    // Resume keeps persisted off (except Cursor's existing flag-clearing behavior).
    fs.writeFileSync(path.join(stateDir, stateFile), 'off');
    assert.equal(checked(run(activate, { ...env, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'feral' })), '');
    if (!extra.CURSOR_VERSION) assert.equal(fs.readFileSync(path.join(stateDir, stateFile), 'utf8'), 'off');
  }
});

test('Qoder bare and status commands emit one JSON ruleset or explicit off report', t => {
  const f = fixture(t);
  const env = { ...f.env, QODER_SESSION_ID: 'safety' };
  const file = path.join(f.dir, '.qoder', stateFile);
  for (const mode of ['focused', 'full-send', 'feral', 'off']) {
    for (const command of ['/ponytail-on-stimulants', '/ponytail-on-stimulants:ponytail-on-stimulants']) {
      for (const suffix of ['', ' status']) {
        fs.writeFileSync(file, mode);
        const output = JSON.parse(checked(run(tracker, env, JSON.stringify({ prompt: command + suffix }))));
        assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
        assert.equal(output.hookSpecificOutput.additionalContext, mode === 'off'
          ? 'PONYTAIL ON STIMULANTS ACTIVE — mode: off' : getPonytailInstructions(mode));
        assert.equal(fs.readFileSync(file, 'utf8'), mode);
      }
    }
  }
});

test('QODER_CONFIG_DIR controls activation, tracking and subagent mode state', t => {
  const f = fixture(t);
  const custom = path.join(f.dir, 'custom qoder');
  const env = { ...f.env, QODER_SESSION_ID: 'safety', QODER_CONFIG_DIR: custom };
  const file = path.join(custom, stateFile);
  const fallback = path.join(f.dir, '.qoder', stateFile);
  const runtimeStateDir = checked(spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(runtime)}).stateDir)`], {
    env, encoding: 'utf8', timeout: 4000,
  }));
  assert.equal(runtimeStateDir, custom);
  JSON.parse(checked(run(tracker, env, JSON.stringify({ prompt: 'Fix a bug' }))));
  assert.equal(fs.readFileSync(file, 'utf8'), 'focused');
  checked(run(tracker, env, JSON.stringify({ prompt: '/ponytail-on-stimulants full-send' })));
  const context = JSON.parse(checked(run(subagent, env))).hookSpecificOutput.additionalContext;
  assert.equal(context, getPonytailInstructions('full-send'));
  checked(run(activate, env));
  assert.equal(fs.readFileSync(file, 'utf8'), 'full-send');
  checked(run(tracker, env, JSON.stringify({ prompt: '/ponytail-on-stimulants off' })));
  assert.equal(fs.readFileSync(file, 'utf8'), 'off');
  assert.equal(checked(run(tracker, env, JSON.stringify({ prompt: 'Fix another bug' }))), '');
  assert.equal(checked(run(activate, { ...env, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'off' }, '', ['--reset'])), '');
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(fallback, 'utf8'), 'feral');
});

test('Codex context envelopes never emit warning-style systemMessage', t => {
  const f = fixture(t);
  const env = { ...f.env, PLUGIN_DATA: f.codex };
  const output = JSON.parse(checked(run(activate, env, '', ['--reset'])));
  assert.equal(output.systemMessage, undefined);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(output.hookSpecificOutput.additionalContext, getPonytailInstructions('focused'));
  const report = JSON.parse(checked(run(tracker, env, JSON.stringify({ prompt: '/ponytail-on-stimulants status' }))));
  assert.equal(report.systemMessage, undefined);
  assert.equal(report.hookSpecificOutput.additionalContext, 'PONYTAIL ON STIMULANTS ACTIVE — mode: focused');
  const empty = checked(spawnSync(process.execPath, ['-e', `require(${JSON.stringify(runtime)}).writeHookOutput('SessionStart', 'focused'); process.exit(0)`], {
    env, encoding: 'utf8', timeout: 4000,
  }));
  assert.deepEqual(JSON.parse(empty), {});
});
