#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildContinuationPrompt,
  claimContinuation,
  collectGitEvidence,
  createTurnState,
  isExecutionPrompt,
  maxContinuations,
  recordToolCall,
  recordToolResult,
  redact,
  shouldRunCompletionPass,
  summarizeTrackedEvidence,
} = require('../completion-gate');
const {
  buildJevPayload,
  compactJevState,
  createJevJudge,
  decideJev,
  parseJevResponse,
} = require('../completion-gate/jev');

function validResponse(overrides = {}) {
  const probabilities = {
    stop: 0.9,
    inspect_repository: 0.01,
    inspect_callers: 0.01,
    run_verification: 0.02,
    investigate_failure: 0.01,
    fix_remaining_work: 0.04,
    escalate_blocker: 0.01,
  };
  return {
    model: 'jev-1.13.0',
    answers: {
      task_complete: { type: 'noul', noul: 0.95 },
      obvious_implied_work_remaining: { type: 'noul', noul: 0.03 },
      verification_sufficient: { type: 'noul', noul: 0.94 },
      scope_creep: { type: 'noul', noul: 0.02 },
      completion_confidence: {
        type: 'score', score: 2.9, confidence: 0.9,
        legend: { 0: 'bad', 1: 'weak', 2: 'ambiguous', 3: 'complete' },
        probabilities: { 0: 0, 1: 0.01, 2: 0.08, 3: 0.91 },
      },
      recommended_next_step: {
        type: 'choice', choice: 'stop', confidence: 0.9, probabilities,
      },
      ...overrides,
    },
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function evidence(state, git = { changedFiles: ['src/a.js'] }) {
  return { tracked: summarizeTrackedEvidence(state), git };
}

test('execution prompt detection excludes informational questions', () => {
  assert.equal(isExecutionPrompt('Fix the parser bug in this repo'), true);
  assert.equal(isExecutionPrompt('What does this parser do?'), false);
  assert.equal(isExecutionPrompt('Tell me a joke'), false);
});

test('modes enforce zero, one, and two forced-pass caps', () => {
  assert.equal(maxContinuations('focused'), 0);
  assert.equal(maxContinuations('full-send'), 1);
  assert.equal(maxContinuations('feral'), 2);
  assert.equal(maxContinuations('off'), 0);
  assert.equal(maxContinuations('unsupported'), 1);
});

test('no mutation or tool evidence does not trigger a pass, even in a dirty worktree', () => {
  const state = createTurnState('Fix the parser bug in this repo');
  assert.equal(shouldRunCompletionPass('full-send', state, evidence(state, { changedFiles: ['pre-existing.js'] })), false);
});

test('full-send triggers one pass after mutation and never a second', () => {
  const state = createTurnState('Fix the parser bug in this repo');
  recordToolCall(state, 'edit', { path: 'parser.js' });
  const runEvidence = evidence(state);
  assert.equal(shouldRunCompletionPass('full-send', state, runEvidence), true);
  const prompt = buildContinuationPrompt({ mode: 'full-send', pass: 1, maximum: 1, evidence: runEvidence });
  assert.equal(claimContinuation(state, prompt, 1), true);
  assert.equal(shouldRunCompletionPass('full-send', state, runEvidence), false);
  assert.equal(claimContinuation(state, prompt, 1), false, 'identical prompt cannot loop');
});

test('feral caps at two passes and tracks tool errors/repeated failures', () => {
  const state = createTurnState('Implement the API change in this repo');
  for (let i = 0; i < 2; i += 1) {
    recordToolCall(state, 'bash', { command: 'npm test' });
    recordToolResult(state, 'bash', { command: 'npm test' }, true);
  }
  const runEvidence = evidence(state);
  assert.equal(runEvidence.tracked.repeatedActions.length, 1);
  assert.equal(runEvidence.tracked.repeatedFailures.length, 1);
  for (let pass = 1; pass <= 2; pass += 1) {
    assert.equal(shouldRunCompletionPass('feral', state, runEvidence), true);
    const prompt = buildContinuationPrompt({ mode: 'feral', pass, maximum: 2, evidence: runEvidence });
    assert.equal(claimContinuation(state, prompt, 2), true);
  }
  assert.equal(shouldRunCompletionPass('feral', state, runEvidence), false);
});

test('tracked command evidence is compact and redacts common secrets', () => {
  const state = createTurnState('Run the tests');
  recordToolCall(state, 'bash', {
    command: 'TYPESAFE_API_KEY="abc value" npm test --token xyz --password="p q" \"secret\": \"json-value\" ghp_12345678901234567890',
  });
  const tracked = summarizeTrackedEvidence(state);
  assert.equal(tracked.recentTools.length, 1);
  assert.match(tracked.recentTools[0].action, /TYPESAFE_API_KEY=\[redacted\]/);
  assert.match(tracked.recentTools[0].action, /--token \[redacted\]/);
  assert.doesNotMatch(JSON.stringify(tracked), /abc value|xyz|p q|json-value|ghp_/);
  assert.doesNotMatch(redact('Authorization: Bearer top-secret'), /top-secret/);
});

test('a successful retry clears the matching unresolved tool failure', () => {
  const state = createTurnState('Run the tests');
  const args = { command: 'npm test' };
  recordToolCall(state, 'bash', args, 'first');
  recordToolResult(state, 'bash', {}, true, 'first');
  assert.equal(summarizeTrackedEvidence(state).toolErrors.length, 1);
  recordToolCall(state, 'bash', args, 'second');
  recordToolResult(state, 'bash', {}, false, 'second');
  const tracked = summarizeTrackedEvidence(state);
  assert.equal(tracked.toolErrors.length, 0);
  assert.deepEqual(tracked.recentTools.map((item) => item.status), ['failed', 'passed']);
});

test('mutation evidence qualifies common requests even without a classifier keyword', () => {
  const state = createTurnState('Please deal with issue 123');
  recordToolCall(state, 'edit', { path: 'a' });
  assert.equal(shouldRunCompletionPass('full-send', state, evidence(state)), true);
  assert.equal(isExecutionPrompt('Please resolve issue 123'), true);
  assert.equal(isExecutionPrompt('Address the review feedback'), true);
});

test('focused and off never force a pass', () => {
  const state = createTurnState('Update the file in this repo');
  recordToolCall(state, 'write', { path: 'a' });
  assert.equal(shouldRunCompletionPass('focused', state, evidence(state)), false);
  assert.equal(shouldRunCompletionPass('off', state, evidence(state)), false);
});

test('git evidence detects changed files, diff errors, and introduced TODOs', async () => {
  const exec = async (_command, args) => {
    const key = args.join(' ');
    if (key === 'rev-parse --is-inside-work-tree') return { code: 0, stdout: 'true\n', stderr: '' };
    if (key === 'status --porcelain') return { code: 0, stdout: ' M src/a.js\n?? src/b.js\n', stderr: '' };
    if (key === 'diff --check') return { code: 2, stdout: '', stderr: 'trailing whitespace' };
    if (key === 'ls-files --others --exclude-standard') return { code: 0, stdout: 'src/new.js\n', stderr: '' };
    if (key.startsWith('grep --no-index')) return { code: 0, stdout: 'src/new.js:2:// FIXME untracked\n', stderr: '' };
    return { code: 0, stdout: '@@\n+const x = 1; // TODO finish\n context TODO old\n', stderr: '' };
  };
  const result = await collectGitEvidence(exec, '/repo');
  assert.deepEqual(result.changedFiles, ['src/a.js', 'src/b.js']);
  assert.equal(result.diffCheckFailed, true);
  assert.deepEqual(result.introducedTodos, [
    'const x = 1; // TODO finish',
    'src/new.js:2:// FIXME untracked',
  ]);
});

test('Jev stays disabled without explicit opt-in and key', () => {
  assert.equal(createJevJudge({ env: {} }), null);
  assert.equal(createJevJudge({ env: { PONYTAIL_ON_STIMULANTS_JEV_ENABLED: '1' } }), null);
});

test('Jev payload contains typed questions and no task or response text', () => {
  const state = compactJevState({
    task: 'pasted source and --token secret-value',
    finalAssistantMessage: 'raw command: PASSWORD=hidden npm test',
    requestMetadata: { hasTask: true, taskLength: 38 },
    responseMetadata: { claimedComplete: true, reportedBlocker: false, responseLength: 44 },
    changedFiles: ['a'],
    deterministicEvidence: { command: 'PASSWORD=hidden npm test' },
  });
  assert.deepEqual(state.request_metadata, { has_task: true, task_length: 38 });
  assert.deepEqual(state.response_metadata, {
    claimed_complete: true, reported_blocker: false, response_length: 44,
  });
  assert.equal(Object.hasOwn(state, 'task'), false);
  assert.equal(Object.hasOwn(state, 'final_assistant_message'), false);
  assert.doesNotMatch(JSON.stringify(state), /secret-value|hidden|pasted source|raw command/);
  const payload = buildJevPayload(state);
  assert.deepEqual(Object.keys(payload.questions), [
    'task_complete', 'obvious_implied_work_remaining', 'verification_sufficient',
    'scope_creep', 'completion_confidence', 'recommended_next_step',
  ]);
});

test('Jev complete, incomplete, and ambiguous policies use probabilities', () => {
  const complete = parseJevResponse(validResponse());
  assert.equal(decideJev(complete).verdict, 'stop');
  const incomplete = parseJevResponse(validResponse({
    task_complete: { type: 'noul', noul: 0.1 },
  }));
  assert.equal(decideJev(incomplete).verdict, 'continue');
  const ambiguous = parseJevResponse(validResponse({
    task_complete: { type: 'noul', noul: 0.65 },
  }));
  assert.equal(decideJev(ambiguous).verdict, 'ambiguous');
  const scopeCreep = parseJevResponse(validResponse({
    scope_creep: { type: 'noul', noul: 0.9 },
  }));
  assert.equal(decideJev(scopeCreep).verdict, 'continue');
  const contradictory = parseJevResponse(validResponse({
    recommended_next_step: {
      type: 'choice', choice: 'inspect_callers', confidence: 0.9,
      probabilities: {
        stop: 0.9, inspect_repository: 0.01, inspect_callers: 0.01,
        run_verification: 0.02, investigate_failure: 0.01,
        fix_remaining_work: 0.04, escalate_blocker: 0.01,
      },
    },
  }));
  assert.equal(decideJev(contradictory).verdict, 'ambiguous');
});

test('Jev judge fails open on malformed response and service failure', async () => {
  const env = { PONYTAIL_ON_STIMULANTS_JEV_ENABLED: '1', TYPESAFE_API_KEY: 'secret' };
  const malformed = createJevJudge({ env, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  const malformedResult = await malformed({ task: 'x' });
  assert.equal(malformedResult.verdict, 'unavailable');
  assert.equal(malformedResult.reason, 'transport_or_malformed');
  assert.ok(malformedResult.latencyMs >= 0);
  const failed = createJevJudge({ env, fetchImpl: async () => ({ ok: false, status: 529 }) });
  const failedResult = await failed({ task: 'x' });
  assert.equal(failedResult.verdict, 'unavailable');
  assert.equal(failedResult.reason, 'http_529');
});

test('Jev judge enforces a total timeout and never includes the key in its result', async () => {
  const env = { PONYTAIL_ON_STIMULANTS_JEV_ENABLED: 'true', TYPESAFE_API_KEY: 'super-secret' };
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const judge = createJevJudge({ env, fetchImpl, timeoutMs: 10 });
  const result = await judge({ task: 'x' });
  assert.equal(result.verdict, 'unavailable');
  assert.equal(result.reason, 'timeout');
  assert.ok(result.latencyMs >= 10);
  assert.doesNotMatch(JSON.stringify(result), /super-secret/);
});

test('invalid Jev numeric configuration falls back safely', async () => {
  const env = {
    PONYTAIL_ON_STIMULANTS_JEV_ENABLED: '1',
    TYPESAFE_API_KEY: 'secret',
    PONYTAIL_ON_STIMULANTS_JEV_TIMEOUT_MS: 'not-a-number',
    PONYTAIL_ON_STIMULANTS_JEV_RETRIES: 'not-a-number',
  };
  const judge = createJevJudge({
    env,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => validResponse() }),
  });
  assert.equal((await judge({ task: 'fix it' })).verdict, 'stop');
});

test('Jev judge returns validated complete evidence without putting credentials in the payload', async () => {
  const env = { PONYTAIL_ON_STIMULANTS_JEV_ENABLED: '1', TYPESAFE_API_KEY: 'secret' };
  let request;
  const judge = createJevJudge({
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => validResponse() };
    },
  });
  const result = await judge({
    task: 'private task text',
    finalAssistantMessage: 'private assistant text',
    requestMetadata: { hasTask: true, taskLength: 17 },
  });
  assert.equal(result.verdict, 'stop');
  assert.equal(result.answers.recommended_next_step.probabilities.stop, 0.9);
  assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
  assert.doesNotMatch(request.options.body, /secret|private task text|private assistant text/);
  assert.equal(request.options.headers.authorization, 'Bearer secret');
});
