import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import extension from '../index.js';

function harness({ entries = [], exec, sendError = false, jevJudge } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const statuses = [];
  const notifications = [];
  const appended = [];
  const sent = [];
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    async exec(command, args) {
      if (exec) return exec(command, args);
      const key = args.join(' ');
      if (key === 'rev-parse --is-inside-work-tree') return { code: 0, stdout: 'true\n', stderr: '' };
      if (key === 'status --porcelain') return { code: 0, stdout: ' M file.js\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    sendUserMessage(message, options) {
      if (sendError) throw new Error('queue unavailable');
      sent.push(message);
      assert.deepEqual(options, { deliverAs: 'followUp' });
    },
    appendEntry(customType, data) { appended.push({ customType, data }); },
  };
  const ctx = {
    cwd: '/repo',
    hasUI: true,
    sessionManager: { getEntries: () => entries },
    ui: {
      theme: { fg: (_kind, value) => value },
      setStatus(key, value) { statuses.push([key, value]); },
      notify(message, level) { notifications.push([message, level]); },
    },
  };
  extension(pi, { jevJudge });
  return { handlers, commands, statuses, notifications, appended, sent, pi, ctx };
}

async function start(h) {
  await h.handlers.get('session_start')({}, h.ctx);
}

async function beginExecution(h, prompt = 'Fix the parser bug in this repository') {
  await h.handlers.get('input')({ source: 'interactive', text: prompt }, h.ctx);
  await h.handlers.get('tool_execution_start')({ toolCallId: 'edit-1', toolName: 'edit', args: { path: 'parser.js' } }, h.ctx);
  await h.handlers.get('message_end')({ message: { role: 'assistant', content: 'Implemented.' } }, h.ctx);
}

test('registers only fork-namespaced commands and status key', async () => {
  const h = harness();
  assert.deepEqual([...h.commands.keys()].sort(), [
    'ponytail-on-stimulants',
    'ponytail-on-stimulants-audit',
    'ponytail-on-stimulants-debt',
    'ponytail-on-stimulants-gain',
    'ponytail-on-stimulants-help',
    'ponytail-on-stimulants-review',
  ]);
  await start(h);
  assert.equal(h.statuses.at(-1)[0], 'ponytail-on-stimulants');
  assert.match(h.statuses.at(-1)[1], /full-send/i);
  assert.equal(h.handlers.has('agent_settled'), false, 'continuations must queue before Pi emits public settlement');
});

test('canonical mode input persists a fork session entry', async () => {
  const h = harness();
  await start(h);
  await h.commands.get('ponytail-on-stimulants').handler('feral', h.ctx);
  assert.deepEqual(h.appended.at(-1), {
    customType: 'ponytail-on-stimulants-mode',
    data: { mode: 'feral' },
  });
  assert.match(h.statuses.at(-1)[1], /feral/i);
});

test('before_agent_start injects fork instructions unless off', async () => {
  const h = harness();
  await start(h);
  const injected = await h.handlers.get('before_agent_start')({ systemPrompt: 'base' }, h.ctx);
  assert.match(injected.systemPrompt, /PONYTAIL ON STIMULANTS ACTIVE/);
  assert.match(injected.systemPrompt, /full-send/);
  await h.commands.get('ponytail-on-stimulants').handler('off', h.ctx);
  assert.equal(await h.handlers.get('before_agent_start')({ systemPrompt: 'base' }, h.ctx), undefined);
});

test('no mutation or operational evidence means no completion pass', async () => {
  const h = harness({ exec: async (_command, args) => {
    if (args.join(' ') === 'rev-parse --is-inside-work-tree') return { code: 0, stdout: 'true\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  } });
  await start(h);
  await h.handlers.get('input')({ source: 'interactive', text: 'Fix the parser bug' }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.deepEqual(h.sent, []);
});

test('full-send queues exactly one pass; extension follow-up does not reset it', async () => {
  const h = harness();
  await start(h);
  await beginExecution(h);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /COMPLETION PASS 1\/1/);
  assert.match(h.statuses.at(-1)[1], /pass 1\/1/i);
  assert.match(h.notifications.at(-1)[0], /Completion pass 1\/1 queued/);
  await h.handlers.get('input')({ source: 'extension', text: h.sent[0] }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.equal(h.sent.length, 1);
});

test('a new human turn resets the bounded completion counter', async () => {
  const h = harness();
  await start(h);
  await beginExecution(h);
  await h.handlers.get('agent_end')({}, h.ctx);
  await beginExecution(h, 'Now fix the serializer too');
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1], /COMPLETION PASS 1\/1/);
});

test('feral queues at most two passes', async () => {
  const h = harness({ entries: [{ type: 'custom', customType: 'ponytail-on-stimulants-mode', data: { mode: 'feral' } }] });
  await start(h);
  await beginExecution(h);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.match(h.sent[0], /COMPLETION PASS 1\/2/);
  await h.handlers.get('input')({ source: 'extension', text: h.sent[0] }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.match(h.sent[1], /COMPLETION PASS 2\/2/);
  await h.handlers.get('input')({ source: 'extension', text: h.sent[1] }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.equal(h.sent.length, 2);
});

test('focused mode never forces a continuation', async () => {
  const h = harness({ entries: [{ type: 'custom', customType: 'ponytail-on-stimulants-mode', data: { mode: 'focused' } }] });
  await start(h);
  await beginExecution(h);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.equal(h.sent.length, 0);
});

test('real Pi tool-end shape is correlated to start arguments', async () => {
  const h = harness();
  await start(h);
  await beginExecution(h);
  await h.handlers.get('tool_execution_start')({
    toolCallId: 'bash-1', toolName: 'bash', args: { command: 'npm test --token top-secret' },
  }, h.ctx);
  await h.handlers.get('tool_execution_end')({ toolCallId: 'bash-1', toolName: 'bash', result: {}, isError: true }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.match(h.sent[0], /"tool_error_count":1/);
  assert.doesNotMatch(h.sent[0], /top-secret/);
});

test('a new human turn invalidates asynchronous evidence collection', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = harness({ exec: async (_command, args) => {
    if (args.join(' ') === 'rev-parse --is-inside-work-tree') return blocked;
    return { code: 0, stdout: '', stderr: '' };
  } });
  await start(h);
  await beginExecution(h);
  const settling = h.handlers.get('agent_end')({}, h.ctx);
  await Promise.resolve();
  await h.handlers.get('input')({ source: 'interactive', text: 'Explain the parser' }, h.ctx);
  release({ code: 0, stdout: 'true\n', stderr: '' });
  await settling;
  assert.deepEqual(h.sent, []);
});

test('Jev is advisory and cannot suppress feral second pass', async () => {
  let judgedState;
  const h = harness({
    entries: [{ type: 'custom', customType: 'ponytail-on-stimulants-mode', data: { mode: 'feral' } }],
    jevJudge: async (state) => {
      judgedState = state;
      return { verdict: 'stop', model: 'fake-jev', answers: { task_complete: 0.99 } };
    },
  });
  await start(h);
  await beginExecution(h);
  await h.handlers.get('tool_execution_start')({
    toolCallId: 'secret-bash', toolName: 'bash', args: { command: 'TOKEN=top-secret npm test' },
  }, h.ctx);
  await h.handlers.get('tool_execution_end')({ toolCallId: 'secret-bash', toolName: 'bash', result: {}, isError: false }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  await h.handlers.get('input')({ source: 'extension', text: h.sent[0] }, h.ctx);
  await h.handlers.get('agent_end')({}, h.ctx);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1], /COMPLETION PASS 2\/2/);
  assert.match(h.sent[1], /"verdict":"stop"/);
  assert.doesNotMatch(JSON.stringify(judgedState), /top-secret|Fix the parser bug|Implemented\./);
  assert.equal(Object.hasOwn(judgedState, 'task'), false);
  assert.equal(Object.hasOwn(judgedState, 'finalAssistantMessage'), false);
  assert.equal(h.appended.at(-1).data.jev.verdict, 'stop');
  assert.equal(h.appended.at(-1).data.jev.model, 'fake-jev');
  assert.deepEqual(h.appended.at(-1).data.jev.answers, { task_complete: 0.99 });
});

test('completion-loop integration fails open when continuation delivery fails', async () => {
  const h = harness({ sendError: true });
  await start(h);
  await beginExecution(h);
  await assert.doesNotReject(() => h.handlers.get('agent_end')({}, h.ctx));
  assert.equal(h.sent.length, 0);
});

test('structured Pi sections preserve other owners and clear on off', async () => {
  const h = harness();
  await start(h);
  const sections = { other: 'Keep me' };
  const event = { systemPrompt: 'base', systemPromptOptions: { sections } };
  assert.equal(await h.handlers.get('before_agent_start')(event), undefined);
  assert.equal(sections.other, 'Keep me');
  assert.match(sections['ponytail-on-stimulants'], /full-send/);
  await h.commands.get('ponytail-on-stimulants').handler('off', h.ctx);
  await h.handlers.get('before_agent_start')(event);
  assert.deepEqual(sections, { other: 'Keep me' });
});

test('Pi forced prompts receive rules in rendered text rather than ignored sections', async () => {
  const h = harness();
  await start(h);
  const options = { sections: { other: 'Keep me' }, forceSystemPrompt: 'Earlier extension instructions' };
  const event = { systemPromptOptions: options, get systemPrompt() { return options.forceSystemPrompt; } };
  const result = await h.handlers.get('before_agent_start')(event);
  assert.match(result.systemPrompt, /^Earlier extension instructions\n\n/);
  assert.match(result.systemPrompt, /PONYTAIL ON STIMULANTS ACTIVE/);
  assert.deepEqual(options.sections, { other: 'Keep me' });
});

test('OMP prompt arrays stay arrays without mutating the host prompt', async () => {
  const h = harness();
  await start(h);
  const original = ['first', 'second'];
  const result = await h.handlers.get('before_agent_start')({ systemPrompt: original });
  assert.deepEqual(result.systemPrompt.slice(0, 2), original);
  assert.match(result.systemPrompt[2], /full-send/);
  assert.deepEqual(original, ['first', 'second']);
});

for (const name of ['session_tree', 'session_switch', 'session_branch']) {
  test(`${name} restores branch mode and invalidates old completion state`, async () => {
    const h = harness();
    await start(h);
    await beginExecution(h);
    h.ctx.sessionManager.getBranch = () => [{ type: 'custom', customType: 'ponytail-on-stimulants-mode', data: { mode: 'focused' } }];
    await h.handlers.get(name)({}, h.ctx);
    const result = await h.handlers.get('before_agent_start')({ systemPrompt: '' });
    assert.match(result.systemPrompt, /mode: focused/);
    await h.handlers.get('agent_end')({}, h.ctx);
    assert.equal(h.sent.length, 0);
  });
}

test('bare command preserves active mode; autocomplete offers complete commands', async () => {
  const h = harness();
  await start(h);
  const command = h.commands.get('ponytail-on-stimulants');
  await command.handler('feral', h.ctx);
  await command.handler('', h.ctx);
  assert.match(h.notifications.at(-1)[0], /current feral/);
  assert.deepEqual(command.getArgumentCompletions('default f').map((item) => item.value), ['default focused', 'default full-send', 'default feral']);
  assert.equal(command.getArgumentCompletions('no-such-mode'), null);
});

test('abort and provider error do not trigger a completion follow-up', async () => {
  for (const stopReason of ['aborted', 'error']) {
    const h = harness();
    await start(h);
    await beginExecution(h);
    await h.handlers.get('agent_end')({ messages: [{ role: 'assistant', stopReason }] }, h.ctx);
    assert.equal(h.sent.length, 0);
  }
});

test('headless theme proxies do not prevent prompt injection', async () => {
  const h = harness();
  Object.defineProperty(h.ctx.ui, 'theme', { get() { throw new Error('not initialized'); } });
  await start(h);
  assert.match((await h.handlers.get('before_agent_start')({ systemPrompt: 'base' })).systemPrompt, /full-send/);
});

test('root package points Pi at the renamed skill collection', () => {
  const root = join(import.meta.dirname, '..', '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.pi.skills, ['./skills']);
  assert.match(readFileSync(join(root, 'skills', 'ponytail-on-stimulants', 'SKILL.md'), 'utf8'), /name: ponytail-on-stimulants/);
});

test('settled turns append one recap; queued passes and aborted turns do not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ponytail-on-stimulants-pi-recap-'));
  const recaps = join(dir, 'recaps.tsv');
  const previous = process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE;
  process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE = recaps;
  const lines = () => (existsSync(recaps) ? readFileSync(recaps, 'utf8').split('\n').filter(Boolean) : []);
  try {
    const h = harness();
    h.ctx.sessionManager.getSessionId = () => 'pi-session';
    await start(h);
    await beginExecution(h);
    await h.handlers.get('agent_end')({}, h.ctx);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(lines(), [], 'a queued pass keeps the turn open');
    await h.handlers.get('input')({ source: 'extension', text: h.sent[0] }, h.ctx);
    await h.handlers.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed the parser bug.' }] } }, h.ctx);
    await h.handlers.get('agent_end')({}, h.ctx);
    assert.equal(lines().length, 1);
    assert.match(lines()[0], /\tpi\t\/repo\t-\tpi-session\tdirty=1 tools=1 errors=0\tFix the parser bug in this repository → Implemented\.$/, 'the pre-pass answer wins');

    await h.handlers.get('input')({ source: 'interactive', text: 'Explain the parser' }, h.ctx);
    await h.handlers.get('agent_end')({ messages: [{ role: 'assistant', stopReason: 'aborted' }] }, h.ctx);
    assert.equal(lines().length, 1);

    process.env.PI_SUBAGENT_CHILD = '1';
    await h.handlers.get('input')({ source: 'interactive', text: 'Subagent task' }, h.ctx);
    await h.handlers.get('agent_end')({}, h.ctx);
    delete process.env.PI_SUBAGENT_CHILD;
    assert.equal(lines().length, 1, 'pi-subagents children are not recapped');
  } finally {
    if (previous === undefined) delete process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE;
    else process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
