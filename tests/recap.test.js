'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSpawnExec, createTurnState, recordToolCall, recordToolResult, restoreTurnState, serializeTurnState } = require('../completion-gate');
const { formatRecap, oneLine, recordRecap } = require('../completion-gate/recap');

function withRecapFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-recap-'));
  const previous = { file: process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE, enabled: process.env.PONYTAIL_ON_STIMULANTS_RECAP };
  process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE = path.join(dir, 'nested', 'recaps.tsv');
  delete process.env.PONYTAIL_ON_STIMULANTS_RECAP;
  const read = () => {
    try { return fs.readFileSync(process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE, 'utf8').split('\n').filter(Boolean); }
    catch (_) { return []; }
  };
  return Promise.resolve(fn({ dir, read })).finally(() => {
    process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE = previous.file;
    if (previous.enabled === undefined) delete process.env.PONYTAIL_ON_STIMULANTS_RECAP;
    else process.env.PONYTAIL_ON_STIMULANTS_RECAP = previous.enabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('oneLine keeps the first plain sentence, strips markdown, redacts and truncates', () => {
  assert.equal(oneLine('\n\n**Everything is up to date.** The fork now matches upstream.', 160), 'Everything is up to date.');
  assert.equal(oneLine('- `bun test` passed for snake_case_name', 160), 'bun test passed for snake_case_name');
  assert.equal(oneLine('## Done\nmore', 160), 'Done');
  assert.equal(oneLine('use token=abc123secret now', 160), 'use token=[redacted] now');
  const long = oneLine('x'.repeat(300), 80);
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
  assert.equal(oneLine('', 80), '');
});

test('formatRecap emits exactly seven tab-separated fields', () => {
  const line = formatRecap({ time: 't', harness: 'h', project: 'p\tq', branch: 'b', session: 's', stats: 'x', ask: 'fix\nit', outcome: 'done' });
  assert.deepEqual(line.split('\t'), ['t', 'h', 'p q', 'b', 's', 'x', 'fix it → done']);
  assert.equal(formatRecap({ ask: 'only' }).split('\t').at(-1), 'only');
});

test('recordRecap appends one greppable line with branch and turn stats, once per turn', () => withRecapFile(async ({ dir, read }) => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q', '-b', 'recap-branch'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.js'), '1');
  const state = createTurnState('Fix the parser bug\nwith details');
  recordToolCall(state, 'edit', { path: 'a.js' }, '1');
  recordToolResult(state, 'edit', {}, true, '1');
  const line = await recordRecap({
    harness: 'claude', cwd: repo, session: 'abcdefghijklmnopqrstuvwxyz', state,
    reply: 'Fixed the parser. Tests pass.', exec: createSpawnExec(), now: new Date('2026-10-18T09:41:03.500Z'),
  });
  assert.deepEqual(read(), [line]);
  assert.deepEqual(line.split('\t'), [
    '2026-10-18T09:41:03Z', 'claude', repo, 'recap-branch', 'abcdefghijklmnop',
    'dirty=1 tools=1 errors=1', 'Fix the parser bug → Fixed the parser.',
  ]);
  assert.equal(await recordRecap({ harness: 'claude', cwd: repo, state, reply: 'again' }), null);
  const restored = restoreTurnState(serializeTurnState(state));
  assert.equal(await recordRecap({ harness: 'claude', cwd: repo, state: restored, reply: 'again' }), null, 'dedupe survives hook processes');
  assert.equal(read().length, 1);

  const commit = ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'x'];
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', commit, { cwd: repo });
  spawnSync('git', ['checkout', '-q', '--detach'], { cwd: repo });
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const detached = await recordRecap({ harness: 'codex', cwd: repo, state: createTurnState('Ship it'), exec: createSpawnExec() });
  assert.equal(detached.split('\t')[3], `@${sha}`);
  assert.equal(detached.split('\t')[5], 'dirty=0 tools=0 errors=0');
}));

test('recordRecap skips disabled, empty and continuation turns and fails open', () => withRecapFile(async ({ dir, read }) => {
  process.env.PONYTAIL_ON_STIMULANTS_RECAP = '0';
  assert.equal(await recordRecap({ harness: 'pi', cwd: dir, state: createTurnState('Fix it') }), null);
  delete process.env.PONYTAIL_ON_STIMULANTS_RECAP;
  assert.equal(await recordRecap({ harness: 'pi', cwd: dir, state: createTurnState('   ') }), null);
  assert.equal(await recordRecap({ harness: 'pi', cwd: dir, state: createTurnState('PONYTAIL ON STIMULANTS COMPLETION PASS 1/1') }), null);
  assert.deepEqual(read(), []);
  const line = await recordRecap({ harness: 'pi', cwd: dir, state: createTurnState('Explain this'), exec: async () => { throw new Error('no git'); } });
  assert.match(line, /\tpi\t.*\t-\tdefault\tdirty=0 tools=0 errors=0\tExplain this$/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(dir, 'not a directory');
  assert.equal(await recordRecap({ harness: 'pi', cwd: dir, state: createTurnState('Write fails') }), null);
  fs.rmSync(dir, { force: true });
}));
