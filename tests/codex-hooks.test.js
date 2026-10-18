'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'codex-hooks.js');

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('installs runnable user-level Codex hooks, idempotently, preserving other hooks', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-codex-hooks-'));
  const codexHome = path.join(home, '.codex');
  const file = path.join(codexHome, 'hooks.json');
  const recaps = path.join(home, 'recaps.tsv');
  const other = { hooks: [{ type: 'command', command: 'echo other' }] };
  fs.mkdirSync(codexHome);
  fs.writeFileSync(file, JSON.stringify({ description: 'mine', hooks: { Stop: [other] } }));
  const env = { CODEX_HOME: codexHome, HOME: home };
  try {
    assert.equal(run(['install'], env).status, 0);
    assert.equal(run(['install'], env).status, 0);
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(config.description, 'mine');
    assert.deepEqual(config.hooks.Stop[0], other);
    assert.equal(config.hooks.Stop.length, 2, 're-install replaces instead of duplicating');
    const template = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'codex-hooks.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.hooks).sort(), Object.keys(template.hooks).sort());
    for (const groups of Object.values(config.hooks)) {
      for (const hook of groups.flatMap((group) => group.hooks)) {
        if (hook.command === 'echo other') continue;
        assert.doesNotMatch(hook.command, /CLAUDE_PLUGIN_ROOT/);
        assert.match(hook.command, /^PLUGIN_DATA='.+\/\.codex\/ponytail-on-stimulants' node '.+\/hooks\/ponytail-on-stimulants-[\w-]+\.js'/);
      }
    }

    const commands = (event) => config.hooks[event].flatMap((group) => group.hooks).map((item) => item.command).filter((item) => item !== 'echo other');
    const hook = (event, data) => commands(event).map((item) => spawnSync('/bin/sh', ['-c', item], {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, PONYTAIL_ON_STIMULANTS_RECAP_FILE: recaps },
      input: JSON.stringify({ hook_event_name: event, session_id: 'codex-1', cwd: home, ...data }),
      encoding: 'utf8',
    })).at(-1);
    assert.equal(hook('UserPromptSubmit', { prompt: 'Explain the parser' }).status, 0);
    const stop = hook('Stop', { last_assistant_message: 'It tokenizes first.' });
    assert.equal(stop.status, 0, stop.stderr);
    assert.match(fs.readFileSync(recaps, 'utf8'), /\tcodex\t~\t-\tcodex-1\t.*\tExplain the parser → It tokenizes first\.\n$/);
    assert.ok(fs.readdirSync(path.join(codexHome, 'ponytail-on-stimulants')).some((name) => name.startsWith('.ponytail-on-stimulants-turn-')));

    assert.equal(run(['uninstall'], env).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { description: 'mine', hooks: { Stop: [other] } });
    fs.writeFileSync(file, '{}');
    run(['install'], env);
    run(['uninstall'], env);
    assert.equal(fs.existsSync(file), false, 'a file holding only fork hooks is removed');
    assert.match(run(['uninstall'], env).stdout, /No Ponytail on Stimulants hooks/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('refuses to rewrite malformed Codex hooks.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-codex-bad-'));
  const file = path.join(home, 'hooks.json');
  fs.writeFileSync(file, '{broken');
  try {
    const result = run(['install'], { CODEX_HOME: home });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON; nothing was changed/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
