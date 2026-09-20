#!/usr/bin/env node
// Smoke test for the OpenCode adapter: the plugin's hooks behave against the
// real (structural) OpenCode hook shapes. No live OpenCode needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// Point the plugin's mode-flag at a temp config home BEFORE it loads — the
// plugin resolves its state path once at load (as it does under a real OpenCode
// process, where XDG_CONFIG_HOME is already set). The dynamic import below runs
// after this assignment, so the ordering holds.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-opencode-'));
process.env.XDG_CONFIG_HOME = tmp;
delete process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
const statePath = path.join(tmp, 'opencode', '.ponytail-on-stimulants-active');

let loadPlugin, parseCommandFile;
test.before(async () => {
  const url = pathToFileURL(path.join(__dirname, '..', '.opencode', 'plugins', 'ponytail-on-stimulants.mjs'));
  const mod = await import(url);
  loadPlugin = mod.default;
  // The frontmatter parser used to be exported from the plugin module itself.
  // OpenCode's legacy loader treats every exported function as a plugin and
  // tried to invoke it with the plugin context object, which crashed. The
  // parser now lives in its own .cjs sibling; require it directly.
  parseCommandFile = require(path.join(__dirname, '..', '.opencode', 'plugins', 'ponytail-on-stimulants-frontmatter.cjs')).parseCommandFile;
});

function transform(hooks) {
  const output = { system: [] };
  return hooks['experimental.chat.system.transform']({ model: {} }, output).then(() => output.system);
}

test('system.transform injects the ruleset at the default mode (full)', async () => {
  try { fs.unlinkSync(statePath); } catch (e) {}
  const hooks = await loadPlugin({});
  const system = await transform(hooks);
  assert.equal(system.length, 1);
  assert.match(system[0], /PONYTAIL ON STIMULANTS ACTIVE — mode: full-send/);
  assert.match(system[0], /Minimal architecture\. Maximal execution\./);
});

test('command.execute.before persists /ponytail-on-stimulants ultra, transform follows it', async () => {
  const hooks = await loadPlugin({});
  await hooks['command.execute.before']({ command: 'ponytail-on-stimulants', arguments: 'ultra', sessionID: 's' });
  assert.equal(fs.readFileSync(statePath, 'utf8'), 'feral');
  const system = await transform(hooks);
  assert.match(system[0], /PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);
});

test('/ponytail-on-stimulants off persists off and transform injects nothing', async () => {
  const hooks = await loadPlugin({});
  await hooks['command.execute.before']({ command: 'ponytail-on-stimulants', arguments: 'off', sessionID: 's' });
  assert.equal(fs.readFileSync(statePath, 'utf8'), 'off');
  const system = await transform(hooks);
  assert.deepEqual(system, []);
});

test('system.transform merges into existing system entry (Qwen compat, #296)', async () => {
  try { fs.unlinkSync(statePath); } catch (e) {}
  const hooks = await loadPlugin({});
  const output = { system: ['You are a helpful assistant.'] };
  await hooks['experimental.chat.system.transform']({ model: {} }, output);
  assert.equal(output.system.length, 1, 'must not add a second system entry');
  assert.match(output.system[0], /You are a helpful assistant/);
  assert.match(output.system[0], /PONYTAIL ON STIMULANTS ACTIVE/);
});

test('status reports without changing mode and default persists canonically', async () => {
  const logs = [];
  const hooks = await loadPlugin({ client: { app: { log(event) { logs.push(event.body); } } } });
  fs.writeFileSync(statePath, 'ultra');
  await hooks['command.execute.before']({ command: 'ponytail-on-stimulants', arguments: 'status', sessionID: 's' });
  assert.equal(fs.readFileSync(statePath, 'utf8'), 'ultra');
  assert.match(logs.at(-1).message, /current=feral/);
  await hooks['command.execute.before']({ command: 'ponytail-on-stimulants', arguments: 'default lite', sessionID: 's' });
  const config = JSON.parse(fs.readFileSync(path.join(tmp, 'ponytail-on-stimulants', 'config.json'), 'utf8'));
  assert.equal(config.defaultMode, 'focused');
});

test('unsupported and review arguments do not reset the current mode', async () => {
  const hooks = await loadPlugin({});
  fs.writeFileSync(statePath, 'feral');
  for (const argument of ['bogus', 'review']) {
    await hooks['command.execute.before']({ command: 'ponytail-on-stimulants', arguments: argument, sessionID: 's' });
    assert.equal(fs.readFileSync(statePath, 'utf8'), 'feral');
  }
});

test('unrelated commands do not touch the flag', async () => {
  try { fs.unlinkSync(statePath); } catch (e) {}
  const hooks = await loadPlugin({});
  await hooks['command.execute.before']({ command: 'commit', arguments: 'x', sessionID: 's' });
  assert.equal(fs.existsSync(statePath), false);
});

test('parseCommandFile reads frontmatter description + body, LF and CRLF', () => {
  const lf = path.join(tmp, 'cmd-lf.md');
  fs.writeFileSync(lf, '---\ndescription: do a thing\n---\n\nthe template body\n');
  assert.deepEqual(parseCommandFile(lf), { description: 'do a thing', template: 'the template body' });

  // Windows checkouts (autocrlf) deliver CRLF — the parser must still match.
  const crlf = path.join(tmp, 'cmd-crlf.md');
  fs.writeFileSync(crlf, '---\r\ndescription: do a thing\r\n---\r\n\r\nthe template body\r\n');
  assert.deepEqual(parseCommandFile(crlf), { description: 'do a thing', template: 'the template body' });
});

test('parseCommandFile returns null when there is no frontmatter', () => {
  const bare = path.join(tmp, 'cmd-bare.md');
  fs.writeFileSync(bare, 'no frontmatter here\n');
  assert.equal(parseCommandFile(bare), null);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
