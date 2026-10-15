#!/usr/bin/env node
// Cursor native-adapter contract check (#817). The hooks must speak Cursor's
// hooks.json contract: camelCase events, JSON on stdout (empty stdout is a
// no-op, raw text is a parse error), `additional_context` on sessionStart, and
// `continue` plus `additional_context` on beforeSubmitPrompt. The installer must
// merge into an existing hooks.json without touching unrelated hooks.
//
// Input shapes mirror docs/cursor-hooks.md (Cursor docs and the 3.20.17
// client). This checks the adapter's input/output behavior only; whether the
// model actually receives the context is the live session check in that doc.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const rootFwd = root.replace(/\\/g, '/');
const TEMPLATE = 'hooks/cursor-hooks.json';

// Keep host detection and config resolution deterministic whatever shell the
// suite runs in (a Cursor hook env, a Codex shell, a machine-wide default mode).
for (const key of [
  'CURSOR_VERSION', 'CURSOR_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_CONFIG_DIR', 'PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'QODER_SESSION_ID',
  'PONYTAIL_ON_STIMULANTS_SUBAGENT_MATCHER', 'PONYTAIL_ON_STIMULANTS_DEFAULT_MODE', 'XDG_CONFIG_HOME',
]) {
  delete process.env[key];
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-cursor-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

function run(script, env, input = '', cwd = undefined) {
  return spawnSync(process.execPath, [path.join(root, 'hooks', script)], {
    env: { ...process.env, ...env },
    input,
    cwd,
    encoding: 'utf8',
  });
}

function cli(args, env, cwd = undefined) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'cursor-hooks.js'), ...args], {
    env: { ...process.env, ...env },
    cwd,
    encoding: 'utf8',
  });
}

function parse(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith('{'), `expected JSON on stdout, got: ${result.stdout.slice(0, 80)}`);
  return JSON.parse(result.stdout);
}

// A fresh HOME and workspace per case so flag state cannot leak between cases.
// The env is what Cursor 3.20.17 gives a hook process: CURSOR_VERSION and the
// workspace root in CURSOR_PROJECT_DIR (plus its CLAUDE_PROJECT_DIR alias).
function cursorEnv(name, extra = {}) {
  const home = path.join(temp, name, 'home');
  const project = path.join(temp, name, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return {
    home,
    project,
    flag: path.join(home, '.cursor', '.ponytail-on-stimulants-active'),
    env: {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      CURSOR_VERSION: '3.20.17',
      CURSOR_PROJECT_DIR: project,
      CLAUDE_PROJECT_DIR: project,
      ...extra,
    },
  };
}

function writeFlag(c, mode) {
  fs.mkdirSync(path.dirname(c.flag), { recursive: true });
  fs.writeFileSync(c.flag, mode);
}

test('cursor hooks template is a valid hooks.json with the two events that can inject context', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, TEMPLATE), 'utf8'));
  assert.equal(config.version, 1);
  assert.deepEqual(Object.keys(config.hooks).sort(), ['beforeSubmitPrompt', 'sessionStart']);
  assert.match(config.hooks.sessionStart[0].command, /ponytail-on-stimulants-activate\.js/);
  assert.match(config.hooks.beforeSubmitPrompt[0].command, /ponytail-on-stimulants-mode-tracker\.js/);
  // subagentStart answers only permission/user_message in Cursor, so it must
  // not be registered: it would cost a process per subagent and inject nothing.
  assert.equal(config.hooks.subagentStart, undefined);
  for (const entries of Object.values(config.hooks)) {
    assert.ok(Array.isArray(entries) && entries.length === 1);
    for (const entry of entries) {
      assert.match(entry.command, /^node "PONYTAIL_ON_STIMULANTS_DIR\/hooks\/ponytail-on-stimulants-[\w-]+\.js"(?: --reset)?$/, 'plain node call, quoted absolute path');
      assert.doesNotMatch(entry.command, /(^|\s)exec\s|&&|\|\|/, 'must run under cmd, PowerShell and bash alike');
      assert.equal(typeof entry.timeout, 'number');
      const script = entry.command.match(/hooks\/([\w.-]+\.js)/)[1];
      assert.ok(fs.existsSync(path.join(root, 'hooks', script)), `command references a missing hook script: ${script}`);
    }
  }
});

test('installer preserves valid JSON with invalid hook shapes byte-for-byte', () => {
  for (const value of [null, [], 'text', { hooks: null }, { hooks: [] }, { hooks: { sessionStart: {} } }]) {
    const c = cursorEnv('shape-' + Math.random());
    const file = path.join(c.project, '.cursor', 'hooks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = JSON.stringify(value);
    fs.writeFileSync(file, raw);
    for (const action of ['install', 'uninstall']) {
      const result = cli([action, '--project'], c.env, c.project);
      assert.notEqual(result.status, 0);
      assert.equal(fs.readFileSync(file, 'utf8'), raw);
    }
  }
});

test('ownership matching excludes similarly named user hooks and upstream', () => {
  const { isPonytailHook } = require('../scripts/cursor-hooks');
  assert.equal(isPonytailHook({ command: 'node "/p/hooks/ponytail-on-stimulants-activate.js"' }), true);
  assert.equal(isPonytailHook({ command: 'node "C:\\p\\hooks\\ponytail-on-stimulants-activate.js"' }), true);
  for (const command of [
    'node /p/hooks/ponytail-activate.js',
    'node /p/hooks/my-ponytail-on-stimulants-activate.js',
    'node /p/hooks/ponytail-on-stimulants-activate.js.backup',
    'node /p/scripts/ponytail-on-stimulants-activate.js',
  ]) assert.equal(isPonytailHook({ command }), false, command);
});

test('isCursor is off outside a Cursor hook process', () => {
  const { isCursor } = require('../hooks/ponytail-on-stimulants-runtime');
  assert.equal(isCursor, false);
});

test('sessionStart injects the default-level ruleset as additional_context and keeps state under ~/.cursor', () => {
  const c = cursorEnv('start', { PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'feral' });
  const input = JSON.stringify({
    hook_event_name: 'sessionStart', conversation_id: 'conv-1', session_id: 'conv-1',
    is_background_agent: false, composer_mode: 'agent', workspace_roots: [c.project],
    cursor_version: '3.20.17', model: 'claude-opus-4-7-thinking-max',
  });
  const output = parse(run('ponytail-on-stimulants-activate.js', c.env, input));
  assert.deepEqual(Object.keys(output), ['additional_context']);
  assert.match(output.additional_context, /^PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);
  assert.match(output.additional_context, /aggressive reference search/, 'feral row must survive the mode filter');
  assert.doesNotMatch(output.additional_context, /normal proportional verification/, 'focused row must be filtered out');
  assert.doesNotMatch(output.additional_context, /STATUSLINE SETUP NEEDED/, 'Cursor has no Claude statusline to nudge about');
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'feral');
  assert.equal(fs.existsSync(path.join(c.home, '.claude')), false, 'Cursor state must not land in ~/.claude');
});

test('sessionStart in off mode emits nothing and preserves an off tombstone', () => {
  const c = cursorEnv('off', { PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'off' });
  const result = run('ponytail-on-stimulants-activate.js', c.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'empty stdout is a no-op for Cursor; "OK" would be a JSON parse error');
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'off');
});

test('Cursor running a Claude-format plugin (CLAUDE_PLUGIN_ROOT set) still gets Cursor JSON', () => {
  const c = cursorEnv('plugin', { PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'full-send' });
  const pluginRoot = path.join(c.home, '.cursor', 'plugins', 'ponytail-on-stimulants');
  c.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  c.env.CURSOR_PLUGIN_ROOT = pluginRoot;
  const output = parse(run('ponytail-on-stimulants-activate.js', c.env));
  assert.match(output.additional_context, /^PONYTAIL ON STIMULANTS ACTIVE — mode: full-send/);
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'full-send');
});

test('beforeSubmitPrompt saves selection for the next chat using only supported output', () => {
  const c = cursorEnv('switch', { PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'full-send' });
  writeFlag(c, 'full-send');

  const sw = parse(run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({
    hook_event_name: 'beforeSubmitPrompt', conversation_id: 'conv-1',
    prompt: '/ponytail-on-stimulants focused', attachments: [],
  })));
  assert.equal(sw.continue, true, 'must never block the prompt');
  assert.equal(sw.user_message, undefined, 'Cursor shows user_message only for blocked prompts');
  assert.deepEqual(sw, { continue: true });
  const next = parse(run('ponytail-on-stimulants-activate.js', c.env));
  assert.match(next.additional_context, /mode: focused/);
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'focused');

  // Bare /ponytail-on-stimulants reports the live level without resetting it.
  const report = parse(run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt: '/ponytail-on-stimulants' })));
  assert.deepEqual(report, { continue: true });
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'focused');

  // /ponytail-on-stimulants default persists the default without touching the session level.
  const def = parse(run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt: '/ponytail-on-stimulants default feral' })));
  assert.equal(def.continue, true);
  assert.equal(def.additional_context, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.home, '.config', 'ponytail-on-stimulants', 'config.json'), 'utf8')).defaultMode, 'feral');
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'focused');

  // Persist off as a tombstone so later chat startup does not restore the default.
  const off = parse(run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt: '/ponytail-on-stimulants off' })));
  assert.deepEqual(off, { continue: true });
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'off');
  for (let i = 0; i < 2; i += 1) assert.equal(run('ponytail-on-stimulants-activate.js', c.env).stdout, '');

  writeFlag(c, 'full-send');
  const stop = parse(run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt: 'Stop ponytail-on-stimulants.' })));
  assert.deepEqual(stop, { continue: true });
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'off');

  // Ordinary prompts produce no output at all: Cursor treats empty stdout as "carry on".
  writeFlag(c, 'full-send');
  const plain = run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt: 'add a theme toggle next to dark mode' }));
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, '');
  assert.equal(fs.readFileSync(c.flag, 'utf8'), 'full-send');
});

test('with the always-on rule in the workspace the hooks step back instead of duplicating the ruleset', () => {
  const c = cursorEnv('rule', { PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'full-send' });
  const rule = path.join(c.project, '.cursor', 'rules', 'ponytail-on-stimulants.mdc');
  fs.mkdirSync(path.dirname(rule), { recursive: true });
  fs.copyFileSync(path.join(root, '.cursor', 'rules', 'ponytail-on-stimulants.mdc'), rule);

  const start = parse(run('ponytail-on-stimulants-activate.js', c.env));
  assert.match(start.additional_context, /always-on Cursor rule/);
  assert.ok(start.additional_context.includes(rule), 'notice must name the rule file');
  assert.doesNotMatch(start.additional_context, /PONYTAIL ON STIMULANTS ACTIVE/, 'no second copy of the ruleset');
  assert.equal(fs.existsSync(c.flag), false, 'no mode flag while the rule owns the ruleset');

  for (const prompt of ['/ponytail-on-stimulants feral', '/ponytail-on-stimulants off', 'stop ponytail on stimulants', '/ponytail-on-stimulants']) {
    const out = parse(run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt })));
    assert.equal(out.continue, true);
    assert.deepEqual(out, { continue: true }, 'rule notice belongs to sessionStart, not an unsupported prompt field');
    assert.equal(fs.existsSync(c.flag), false);
  }

  const plain = run('ponytail-on-stimulants-mode-tracker.js', c.env, JSON.stringify({ prompt: 'hello' }));
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, '', 'ordinary prompts stay silent');

  // Project hooks run from the workspace root: the cwd fallback must find the rule too.
  delete c.env.CURSOR_PROJECT_DIR;
  delete c.env.CLAUDE_PROJECT_DIR;
  const viaCwd = parse(run('ponytail-on-stimulants-activate.js', c.env, '', c.project));
  assert.match(viaCwd.additional_context, /always-on Cursor rule/);
});

test('installer merges into an existing ~/.cursor/hooks.json and leaves unrelated hooks alone', () => {
  const home = path.join(temp, 'install', 'home');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const file = path.join(home, '.cursor', 'hooks.json');
  const theirs = {
    version: 1,
    hooks: {
      sessionStart: [{ command: './hooks/their-session.sh' }],
      afterFileEdit: [{ command: './hooks/format.sh', matcher: 'Write' }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(theirs));
  const env = { HOME: home, USERPROFILE: home };

  let result = cli(['install'], env);
  assert.equal(result.status, 0, result.stderr);
  let config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(config.version, 1);
  assert.deepEqual(config.hooks.afterFileEdit, theirs.hooks.afterFileEdit);
  assert.equal(config.hooks.sessionStart[0].command, './hooks/their-session.sh', 'their sessionStart hook stays first and intact');
  assert.equal(config.hooks.sessionStart.length, 2);
  assert.deepEqual(config.hooks.sessionStart[1], { command: `node "${rootFwd}/hooks/ponytail-on-stimulants-activate.js"`, timeout: 5 });
  assert.deepEqual(config.hooks.beforeSubmitPrompt, [{ command: `node "${rootFwd}/hooks/ponytail-on-stimulants-mode-tracker.js"`, timeout: 5 }]);

  // Idempotent: a second install replaces ponytail-on-stimulants's entries, never duplicates them.
  result = cli(['install'], env);
  assert.equal(result.status, 0, result.stderr);
  config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(config.hooks.sessionStart.length, 2);
  assert.equal(config.hooks.beforeSubmitPrompt.length, 1);

  // Uninstall removes only ponytail-on-stimulants's entries.
  result = cli(['uninstall'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), theirs);
});

test('installer creates the file when absent and removes it again when only ponytail-on-stimulants lived there', () => {
  const home = path.join(temp, 'fresh', 'home');
  fs.mkdirSync(home, { recursive: true });
  const env = { HOME: home, USERPROFILE: home };
  const file = path.join(home, '.cursor', 'hooks.json');

  let result = cli(['install'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installed Ponytail on Stimulants hooks in /);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(config.version, 1);
  assert.deepEqual(Object.keys(config.hooks).sort(), ['beforeSubmitPrompt', 'sessionStart']);

  result = cli(['uninstall'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(file), false);

  // Uninstalling on a clean machine is a no-op, not an error.
  result = cli(['uninstall'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No Ponytail on Stimulants hooks/);
});

test('installer --project writes <cwd>/.cursor/hooks.json', () => {
  const home = path.join(temp, 'proj', 'home');
  const project = path.join(temp, 'proj', 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const env = { HOME: home, USERPROFILE: home };

  let result = cli(['install', '--project'], env, project);
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(project, '.cursor', 'hooks.json');
  assert.ok(fs.existsSync(file));
  assert.equal(fs.existsSync(path.join(home, '.cursor', 'hooks.json')), false, '--project must not touch the user file');

  result = cli(['uninstall', '--project'], env, project);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(file), false);
});

test('installer refuses to touch a malformed hooks.json', () => {
  const home = path.join(temp, 'broken', 'home');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const file = path.join(home, '.cursor', 'hooks.json');
  const broken = '{ "version": 1, "hooks": { broken';
  fs.writeFileSync(file, broken);
  const env = { HOME: home, USERPROFILE: home };

  for (const action of ['install', 'uninstall']) {
    const result = cli([action], env);
    assert.notEqual(result.status, 0, `${action} must fail on malformed JSON`);
    assert.match(result.stderr, /not valid JSON/);
    assert.equal(fs.readFileSync(file, 'utf8'), broken, 'malformed file must be left byte-for-byte intact');
  }
});
