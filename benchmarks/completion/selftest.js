#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const corpus = require('./corpus.json');
const arms = require('./arms.json');
const { aggregate, scoreCase } = require('./score');
const { scoreRuns } = require('./run');
const { armEnvironment, counterbalancedMatrix, fixtureDefinitionHash } = require('./evaluate');

assert.deepEqual(Object.keys(arms), ['A_prompt_only', 'B_deterministic', 'C_deterministic_jev']);
assert.equal(corpus.cases.length, 8);
assert.match(fixtureDefinitionHash(), /^[a-f0-9]{64}$/);
const matrix = counterbalancedMatrix(3);
assert.equal(matrix.length, corpus.cases.length * Object.keys(arms).length * 3);
for (const testCase of corpus.cases) {
  const firstArms = matrix.filter((cell) => cell.testCase.id === testCase.id).map((cell) => cell.arm);
  assert.deepEqual(new Set(firstArms), new Set(Object.keys(arms)));
}
const deterministic = armEnvironment('B_deterministic', {
  TYPESAFE_API_KEY: 'must-not-leak', PONYTAIL_ON_STIMULANTS_JEV_ENABLED: '1',
});
const withJev = armEnvironment('C_deterministic_jev', { TYPESAFE_API_KEY: 'key' });
assert.equal(deterministic.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE, 'feral');
assert.equal(deterministic.PONYTAIL_ON_STIMULANTS_JEV_ENABLED, '0');
assert.equal(deterministic.TYPESAFE_API_KEY, undefined);
assert.equal(withJev.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE, 'feral');
assert.equal(withJev.PONYTAIL_ON_STIMULANTS_JEV_ENABLED, '1');

const complete = corpus.cases.map((testCase) => scoreCase(testCase, {
  completed: testCase.required,
  reportedComplete: true,
  failures: [],
  unrelatedChanges: [],
  regression: false,
  costUsd: 0.01,
  durationMs: 100,
}));
const plausibleButIncomplete = corpus.cases.map((testCase) => scoreCase(testCase, {
  completed: testCase.required.filter((item, index) => index === 0),
  reportedComplete: true,
  failures: [{ command: 'affected test', investigated: false, reported: false }],
  unrelatedChanges: ['unrelated rewrite'],
  regression: true,
  costUsd: 0.005,
  durationMs: 50,
}));

const completeSummary = aggregate(complete);
const incompleteSummary = aggregate(plausibleButIncomplete);
assert.equal(completeSummary.task_completion_rate, 1);
assert.equal(completeSummary.premature_stop_rate, 0);
assert.equal(completeSummary.caller_coverage, 1);
assert.equal(completeSummary.verification_depth, 1);
assert.equal(completeSummary.silent_failure_rate, 0);
assert.equal(completeSummary.scope_creep_rate, 0);
assert.equal(completeSummary.regression_rate, 0);
assert.equal(incompleteSummary.task_completion_rate, 0);
assert.equal(incompleteSummary.premature_stop_rate, 1);
assert.equal(incompleteSummary.silent_failure_rate, 1);
assert.equal(incompleteSummary.scope_creep_rate, 1);
assert.equal(incompleteSummary.regression_rate, 1);
assert.ok(incompleteSummary.caller_coverage < 1);
assert.ok(incompleteSummary.verification_depth < 1);

const firstCase = corpus.cases[0];
const investigatedButFailing = scoreCase(firstCase, {
  completed: firstCase.required,
  reportedComplete: true,
  failures: [{ investigated: true, reported: true, resolved: false }],
});
assert.equal(investigatedButFailing.task_completion, 0);
const regressed = scoreCase(firstCase, {
  completed: firstCase.required,
  reportedComplete: true,
  failures: [],
  regression: true,
});
assert.equal(regressed.task_completion, 0);
assert.throws(() => scoreCase(firstCase, { completed: [], costUsd: -1 }), /non-negative/);

const armSummary = scoreRuns({ runs: Object.keys(arms).flatMap((arm) => corpus.cases.map((testCase) => ({
  arm,
  case: testCase.id,
  submission: { completed: testCase.required, reportedComplete: true },
}))) });
assert.deepEqual(Object.keys(armSummary), Object.keys(arms));
for (const arm of Object.values(armSummary)) {
  assert.equal(arm.metrics.task_completion_rate, 1);
  assert.equal(arm.repetitions, 1);
}
assert.throws(() => scoreRuns({ runs: [{
  arm: 'A_prompt_only', case: corpus.cases[0].id, submission: { completed: [] },
}] }), /matrix must include|unbalanced matrix/);

console.log(`Completion corpus self-test: ${corpus.cases.length} complete fixtures pass and ${corpus.cases.length} plausible incomplete fixtures are caught across ${Object.keys(arms).length} arms.`);
