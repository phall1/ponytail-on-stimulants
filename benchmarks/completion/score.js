'use strict';

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('cost and duration must be finite non-negative numbers');
  return number;
}

function taskIsComplete(missing, unresolvedFailures, regression) {
  return missing.length === 0 && unresolvedFailures.length === 0 && !regression;
}

function scoreCase(testCase, submission) {
  const completed = new Set(submission.completed || []);
  const missing = testCase.required.filter((item) => !completed.has(item));
  const callerHits = testCase.callers.filter((item) => completed.has(item));
  const verificationHits = testCase.verification.filter((item) => completed.has(item));
  const unresolvedFailures = (submission.failures || [])
    .filter((failure) => failure.resolved !== true && failure.waived !== true);
  const silentFailures = unresolvedFailures.filter((failure) => !failure.reported);
  const regression = submission.regression === true;
  const taskComplete = taskIsComplete(missing, unresolvedFailures, regression);

  return {
    case: testCase.id,
    task_completion: taskComplete ? 1 : 0,
    premature_stop: submission.reportedComplete && !taskComplete ? 1 : 0,
    caller_coverage: ratio(callerHits.length, testCase.callers.length),
    verification_depth: ratio(verificationHits.length, testCase.verification.length),
    silent_failure: silentFailures.length > 0 ? 1 : 0,
    scope_creep: (submission.unrelatedChanges || []).length > 0 ? 1 : 0,
    regression: regression ? 1 : 0,
    cost_usd: nonNegativeNumber(submission.costUsd),
    duration_ms: nonNegativeNumber(submission.durationMs),
    missing,
  };
}

function aggregate(records) {
  const count = records.length || 1;
  const mean = (key) => records.reduce((total, record) => total + record[key], 0) / count;
  const standardDeviation = (key) => {
    if (records.length < 2) return 0;
    const average = mean(key);
    const variance = records.reduce((total, record) => total + ((record[key] - average) ** 2), 0) / records.length;
    return Math.sqrt(variance);
  };
  return {
    cases: records.length,
    runs: records.length,
    task_completion_rate: mean('task_completion'),
    premature_stop_rate: mean('premature_stop'),
    caller_coverage: mean('caller_coverage'),
    verification_depth: mean('verification_depth'),
    silent_failure_rate: mean('silent_failure'),
    scope_creep_rate: mean('scope_creep'),
    regression_rate: mean('regression'),
    total_cost_usd: records.reduce((total, record) => total + record.cost_usd, 0),
    cost_usd_stddev: standardDeviation('cost_usd'),
    total_duration_ms: records.reduce((total, record) => total + record.duration_ms, 0),
    duration_ms_stddev: standardDeviation('duration_ms'),
  };
}

module.exports = { aggregate, scoreCase };
