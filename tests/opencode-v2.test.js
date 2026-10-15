'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createCompletionHost, eventSessionId } = require('../.opencode/plugins/ponytail-on-stimulants-completion.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stimulants-opencode-v2-'));
process.env.XDG_CONFIG_HOME = temp;
delete process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
let plugin;
test.before(async () => {
  const mod = await import(pathToFileURL(path.resolve('.opencode/plugins/ponytail-on-stimulants.mjs')));
  assert.deepEqual(Object.keys(mod), ['default']);
  plugin = mod.default;
});
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

async function harness({ rejectPrompt } = {}) {
  const commands = new Map(), skills = new Map(), sessionHooks = new Map(), toolHooks = new Map(), prompts = [];
  let wake;
  const queue = [];
  let aborted = false;
  const ctx = {
    location: { directory: temp },
    skill: { async transform(fn) { fn({ add(skill) { skills.set(skill.id, skill); } }); } },
    command: { async transform(fn) { fn({ add(command) { commands.set(command.name, command); } }); } },
    tool: { async hook(name, fn) { toolHooks.set(name, fn); } },
    session: {
      async hook(name, fn) { sessionHooks.set(name, fn); },
      async prompt(prompt) {
        if (rejectPrompt?.(prompt)) throw new Error('session no longer accepts prompts');
        prompts.push(prompt);
        await sessionHooks.get('prompt')({ sessionID: prompt.sessionID, prompt: { text: prompt.text } });
      },
    },
    event: {
      async *subscribe({ signal }) {
        signal.addEventListener('abort', () => { aborted = true; wake?.(); }, { once: true });
        while (!aborted) {
          if (!queue.length) await new Promise((resolve) => { wake = resolve; });
          if (aborted) return;
          const { event, done } = queue.shift();
          yield event;
          done();
        }
      },
    },
  };
  const cleanup = await plugin.setup(ctx);
  const emit = (type, sessionID, extra = {}) => new Promise((done) => {
    queue.push({ event: { type, data: { sessionID }, ...extra }, done });
    wake?.();
  });
  return { commands, skills, sessionHooks, toolHooks, prompts, cleanup, emit };
}

test('package-directory and discovery entry points expose the same plugin', async () => {
  const rootEntry = await import(pathToFileURL(path.resolve('server.js')));
  const autoEntry = await import(pathToFileURL(path.resolve('.opencode/plugins/index.js')));
  assert.equal(rootEntry.default, plugin);
  assert.equal(autoEntry.default, plugin);
});

test('V2 registers commands, skills, owned prompt sections and compaction rules', async () => {
  const h = await harness();
  try {
    assert.equal(plugin.id, 'ponytail-on-stimulants');
    assert.equal(h.commands.size, 6);
    assert.equal(h.skills.size, 6);
    for (const skill of h.skills.values()) {
      assert.ok(skill.description);
      assert.doesNotMatch(skill.content, /^---/);
      assert.ok(fs.existsSync(skill.path));
    }
    for (const name of ['context', 'compaction']) {
      const original = { type: 'text', text: 'host-owned' };
      const event = { system: [original] };
      await h.sessionHooks.get(name)(event);
      assert.equal(event.system[0], original);
      assert.match(event.system[1].text, /mode: full-send/);
    }
    await h.commands.get('ponytail-on-stimulants').execute({ sessionID: 's', prompt: { text: 'off' }, delivery: 'queue' });
    const event = { system: [] };
    await h.sessionHooks.get('context')(event);
    assert.deepEqual(event.system, []);
  } finally { await h.cleanup(); }
});

test('V2 forwards command arguments literally and clears stale attachment offsets', async () => {
  const h = await harness();
  try {
    const prompt = { text: 'feature/$&-fix', files: [{ path: '/a.js', mention: { start: 1, end: 3 } }], skills: [{ name: 'x', mention: { start: 0, end: 1 } }] };
    await h.commands.get('ponytail-on-stimulants-review').execute({ sessionID: 's', prompt, delivery: 'steer' });
    assert.match(h.prompts[0].text, /feature\/\$&-fix/);
    assert.deepEqual(h.prompts[0].files, [{ path: '/a.js' }]);
    assert.deepEqual(h.prompts[0].skills, [{ name: 'x' }]);
    assert.equal(h.prompts[0].delivery, 'steer');
    assert.ok(prompt.files[0].mention, 'never mutate the host prompt');
  } finally { await h.cleanup(); }
});

test('V2 completion uses real execution events, preserves caps, ignores unrelated and interrupted sessions', async () => {
  const h = await harness();
  try {
    await h.commands.get('ponytail-on-stimulants').execute({ sessionID: 's', prompt: { text: 'feral' }, delivery: 'queue' });
    h.prompts.length = 0;
    await h.sessionHooks.get('prompt')({ sessionID: 's', prompt: { text: 'Fix the parser' } });
    await h.toolHooks.get('execute.before')({ sessionID: 's', tool: 'edit', input: { path: 'a.js' }, id: 'edit-1' });
    await h.toolHooks.get('execute.after')({ sessionID: 's', tool: 'edit', input: { path: 'a.js' }, id: 'edit-1', status: 'completed' });
    await h.emit('session.execution.succeeded', 'other');
    await h.emit('session.execution.succeeded', 's', { location: { directory: '/another-project' } });
    assert.equal(h.prompts.length, 0);
    await h.emit('session.execution.succeeded', 's');
    await h.emit('session.status', 's');
    await h.emit('session.idle', 's');
    assert.equal(h.prompts.length, 1, 'deprecated idle notifications must not spend another pass');
    await h.emit('session.execution.succeeded', 's');
    await h.emit('session.execution.succeeded', 's');
    assert.equal(h.prompts.length, 2);
    assert.match(h.prompts[1].text, /COMPLETION PASS 2\/2/);
    await h.sessionHooks.get('prompt')({ sessionID: 's', prompt: { text: 'Fix another bug' } });
    await h.toolHooks.get('execute.before')({ sessionID: 's', tool: 'edit', input: {}, id: 'edit-2' });
    await h.emit('session.execution.interrupted', 's');
    await h.emit('session.execution.succeeded', 's');
    assert.equal(h.prompts.length, 2);
  } finally { await h.cleanup(); }
});

test('V2 keeps consuming execution events after a continuation delivery rejects', async () => {
  const h = await harness({ rejectPrompt: (prompt) => prompt.sessionID === 'rejected' });
  try {
    await h.commands.get('ponytail-on-stimulants').execute({ sessionID: 'mode', prompt: { text: 'full-send' }, delivery: 'queue' });
    h.prompts.length = 0;
    for (const id of ['rejected', 'accepted']) {
      await h.sessionHooks.get('prompt')({ sessionID: id, prompt: { text: 'Fix the parser' } });
      await h.toolHooks.get('execute.before')({ sessionID: id, tool: 'edit', input: {}, id: `edit-${id}` });
      await h.emit('session.execution.succeeded', id);
    }
    assert.equal(h.prompts.length, 1);
    assert.equal(h.prompts[0].sessionID, 'accepted');
    assert.match(h.prompts[0].text, /COMPLETION PASS 1\/1/);
  } finally { await h.cleanup(); }
});

test('message metadata never mistakes message id for session id', () => {
  assert.equal(eventSessionId({ properties: { info: { id: 'msg-1', sessionID: 'session-1' } } }), 'session-1');
  assert.equal(eventSessionId({ properties: { info: { id: 'msg-only' } } }), null);
  assert.equal(eventSessionId({ data: { sessionID: 'v2-session' } }), 'v2-session');
});

test('new prompts invalidate in-flight evidence and concurrent decisions cannot double-queue', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const host = createCompletionHost({ exec: async () => { await pending; return { code: 1, stdout: '', stderr: '' }; } });
  host.reset('s', 'Fix the bug');
  host.recordTool('s', 'edit', {}, '1');
  const decision = host.decide('feral', 's');
  assert.equal(await host.decide('feral', 's'), null);
  host.reset('s', 'Explain this code');
  release();
  assert.equal(await decision, null);
  assert.equal(await host.decide('feral', 'unknown'), null);
});
