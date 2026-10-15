#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function runUninstall(env) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'uninstall.js')], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      XDG_CONFIG_HOME: path.join(temp, 'config-home'),
      PLUGIN_DATA: path.join(temp, 'codex-data'),
      COPILOT_PLUGIN_DATA: path.join(temp, 'copilot-data'),
      QODER_CONFIG_DIR: path.join(temp, 'qoder-data'),
      ...env,
    },
    encoding: 'utf8',
  });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-uninstall-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

const home = path.join(temp, 'home');
const claudeDir = path.join(home, '.claude');
fs.mkdirSync(claudeDir, { recursive: true });

const flagPath = path.join(claudeDir, '.ponytail-on-stimulants-active');
const nudgePath = path.join(claudeDir, '.ponytail-on-stimulants-statusline-nudged');
const turnPath = path.join(claudeDir, '.ponytail-on-stimulants-turn-s1.json');
const upstreamFlagPath = path.join(claudeDir, '.ponytail-active');
fs.writeFileSync(flagPath, 'full-send');
fs.writeFileSync(nudgePath, '');
fs.writeFileSync(turnPath, '{"prompt":"x"}');
fs.writeFileSync(upstreamFlagPath, 'full');

const configDir = path.join(temp, 'config-home', 'ponytail-on-stimulants');
fs.mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({ defaultMode: 'feral' }));

const settingsPath = path.join(claudeDir, 'settings.json');
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash /some/path/ponytail-on-stimulants-statusline.sh' },
}));

// Cursor (#817): the Cursor mode flag goes too, and ~/.cursor/hooks.json loses
// only ponytail-on-stimulants's entries; the user's other hooks stay.
const cursorDir = path.join(home, '.cursor');
fs.mkdirSync(cursorDir, { recursive: true });
const cursorFlagPath = path.join(cursorDir, '.ponytail-on-stimulants-active');
fs.writeFileSync(cursorFlagPath, 'focused');
const cursorHooksPath = path.join(cursorDir, 'hooks.json');
fs.writeFileSync(cursorHooksPath, JSON.stringify({
  version: 1,
  hooks: {
    sessionStart: [
      { command: './hooks/mine.sh' },
      { command: 'node "/p/ponytail-on-stimulants/hooks/ponytail-on-stimulants-activate.js"', timeout: 5 },
    ],
    beforeSubmitPrompt: [{ command: 'node "/p/ponytail-on-stimulants/hooks/ponytail-on-stimulants-mode-tracker.js"', timeout: 5 }],
  },
}));

const opencodeFlagPath = path.join(temp, 'config-home', 'opencode', '.ponytail-on-stimulants-active');
fs.mkdirSync(path.dirname(opencodeFlagPath), { recursive: true });
fs.writeFileSync(opencodeFlagPath, 'feral');

const env = {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(temp, 'config-home'),
};

let result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.existsSync(flagPath), false, 'mode flag must be removed');
assert.equal(fs.existsSync(nudgePath), false, 'statusline nudge flag must be removed');
assert.equal(fs.existsSync(turnPath), false, 'turn state must be removed');
assert.equal(fs.existsSync(opencodeFlagPath), false, 'OpenCode mode flag must be removed');
assert.equal(fs.existsSync(configPath), false, 'config file must be removed');
assert.equal(fs.existsSync(cursorFlagPath), false, 'Cursor mode flag must be removed');
assert.equal(fs.existsSync(upstreamFlagPath), true, 'upstream Ponytail state must remain untouched');
assert.deepEqual(
  JSON.parse(fs.readFileSync(cursorHooksPath, 'utf8')),
  { version: 1, hooks: { sessionStart: [{ command: './hooks/mine.sh' }] } },
  "only ponytail-on-stimulants's entries may leave ~/.cursor/hooks.json",
);

const settingsAfter = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfter.statusLine,
  undefined,
  'ponytail-on-stimulants statusLine entry must be removed',
);

// A user's own, unrelated statusLine must survive untouched.
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash ~/my-custom-statusline.sh' },
}));

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
const settingsAfter2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfter2.statusLine.command,
  'bash ~/my-custom-statusline.sh',
  "a user's own statusLine must not be touched",
);

// #374: a combined statusline (another plugin && ponytail-on-stimulants) must keep the other
// plugin's part — uninstall must not nuke the whole command or leave a husk.
fs.writeFileSync(settingsPath, JSON.stringify({
  statusLine: { type: 'command', command: 'bash ~/caveman-statusline.sh && bash /p/ponytail-on-stimulants-statusline.sh' },
}));

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
const settingsAfter3 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(
  settingsAfter3.statusLine.command,
  'bash ~/caveman-statusline.sh',
  'a combined statusLine must keep the non-ponytail-on-stimulants command',
);

// #434: a malformed settings.json must not crash the script mid-cleanup. It
// can't be safely edited, so uninstall warns and leaves the file byte-for-byte
// intact instead of throwing a SyntaxError after other state was already removed.
const malformedSettings = '{ "statusLine": { "command": "ponytail-on-stimulants-statusline.sh", broken';
fs.writeFileSync(settingsPath, malformedSettings);

result = runUninstall(env);
assert.equal(
  result.status,
  0,
  `expected exit 0 on malformed settings.json, got:\n${result.stdout}${result.stderr}`,
);
assert.ok(
  /malformed/i.test(result.stdout + result.stderr),
  'must warn that the statusLine entry could not be removed',
);
assert.equal(
  fs.readFileSync(settingsPath, 'utf8'),
  malformedSettings,
  'malformed settings.json must be left unchanged',
);

// A malformed ~/.cursor/hooks.json must not crash the script either (#817).
const malformedHooks = '{ "version": 1, "hooks": { broken';
fs.writeFileSync(cursorHooksPath, malformedHooks);

result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
assert.ok(
  /hooks\.json is malformed/.test(result.stdout + result.stderr),
  'must warn that the Cursor hook entries could not be removed',
);
assert.equal(
  fs.readFileSync(cursorHooksPath, 'utf8'),
  malformedHooks,
  'malformed hooks.json must be left unchanged',
);

for (const command of [
  'powershell -ExecutionPolicy Bypass -File "C:\\Program Files\\plugin\\ponytail-on-stimulants-statusline.ps1"',
  'pwsh -File "C:\\plugin\\ponytail-on-stimulants-statusline.ps1"',
  'bash "/plugin path/ponytail-on-stimulants-statusline.sh"',
]) {
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command }, unrelated: true }));
  result = runUninstall(env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { unrelated: true });
}

for (const command of [
  'powershell -ExecutionPolicy Bypass -File "C:\\plugin\\ponytail-on-stimulants-statusline.ps1"; echo keep',
  'false; printf keep; bash /p/ponytail-on-stimulants-statusline.sh',
  "printf '%s' 'a;b'; bash /p/ponytail-on-stimulants-statusline.sh",
  'bash /p/my-ponytail-on-stimulants-statusline.sh',
  'bash /p/ponytail-on-stimulants-statusline.sh.backup',
  'echo /p/ponytail-on-stimulants-statusline.sh',
]) {
  const raw = JSON.stringify({ statusLine: { type: 'command', command } });
  fs.writeFileSync(settingsPath, raw);
  result = runUninstall(env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), raw, 'unrelated or complex shell text must remain byte-for-byte intact');
}

for (const name of ['codex-data', 'copilot-data', 'qoder-data']) {
  const directory = path.join(temp, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '.ponytail-on-stimulants-active'), 'off');
  fs.writeFileSync(path.join(directory, '.ponytail-active'), 'full');
}
result = runUninstall(env);
assert.equal(result.status, 0, result.stderr);
for (const name of ['codex-data', 'copilot-data', 'qoder-data']) {
  assert.equal(fs.existsSync(path.join(temp, name, '.ponytail-on-stimulants-active')), false);
  assert.equal(fs.existsSync(path.join(temp, name, '.ponytail-active')), true);
}

// Running on an already-clean machine must not throw. All paths stay sandboxed.
result = runUninstall({ HOME: path.join(temp, 'home-empty'), USERPROFILE: path.join(temp, 'home-empty'), CLAUDE_CONFIG_DIR: path.join(temp, 'home-empty', '.claude') });
assert.equal(result.status, 0, result.stderr);

console.log('uninstall script checks passed');
