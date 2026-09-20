'use strict';

const { redact } = require('./index');

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 2500;
const MAX_TEXT = 6000;

const QUESTIONS = Object.freeze({
  task_complete: {
    type: 'noul',
    instructions: 'Given the requested outcome and supplied run evidence, is the engineering task substantively complete?',
    criteria: {
      true: 'All requested outcomes are integrated and supported by proportionate evidence.',
      false: 'A requested outcome is missing, contradicted, partial, or unsupported.',
    },
  },
  obvious_implied_work_remaining: {
    type: 'noul',
    instructions: 'Is there directly implied engineering work that remains undone?',
    criteria: {
      true: 'An affected caller, consumer, generated artifact, migration, test, or integration path still needs work.',
      false: 'No directly necessary or mechanically implied work is evident.',
    },
  },
  verification_sufficient: {
    type: 'noul',
    instructions: 'Is the supplied verification evidence proportionate to the implementation blast radius?',
    criteria: {
      true: 'The relevant behavior and integration paths were exercised adequately.',
      false: 'Important changed behavior was not executed or failures remain uninvestigated.',
    },
  },
  scope_creep: {
    type: 'noul',
    instructions: 'Did the implementation expand materially beyond the requested outcome or mechanically implied work?',
    criteria: {
      true: 'The change includes unrelated cleanup, redesign, migration, or speculative work.',
      false: 'The change stayed within the requested and mechanically implied scope.',
    },
  },
  completion_confidence: {
    type: 'score',
    instructions: 'How strongly does the supplied evidence establish substantive task completion?',
    criteria: [
      'Clearly incomplete or contradicted by the evidence',
      'Material work or verification probably remains',
      'Mostly complete but evidence is ambiguous',
      'Complete with proportionate, concrete evidence',
    ],
  },
  recommended_next_step: {
    type: 'choice',
    instructions: 'What is the most useful bounded next action for the coding agent?',
    criteria: {
      stop: 'The task is complete and the evidence is sufficient.',
      inspect_repository: 'Inspect repository structure or conventions before deciding.',
      inspect_callers: 'Trace affected callers, consumers, or sibling paths.',
      run_verification: 'Execute proportionate tests, build, typecheck, or runtime validation.',
      investigate_failure: 'Diagnose an observed command, test, tool, or environment failure.',
      fix_remaining_work: 'Implement directly necessary or mechanically implied remaining work.',
      escalate_blocker: 'A demonstrated external blocker prevents completion.',
    },
  },
});

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
}

function clampText(value, max = MAX_TEXT) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

function sanitizeText(value, maximum) {
  return redact(clampText(value, maximum));
}

function sanitizeList(values, maximumItems) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, maximumItems).map((value) => sanitizeText(value, 500));
}

function safeMetadata(value, fields) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(fields.map(
    ([outputName, inputName, normalize]) => [outputName, normalize(source[inputName])],
  ));
}

function compactJevState(input = {}) {
  return {
    request_metadata: safeMetadata(input.requestMetadata, [
      ['has_task', 'hasTask', Boolean],
      ['task_length', 'taskLength', (value) => boundedInteger(value, 0, 0, 1_000_000)],
    ]),
    response_metadata: safeMetadata(input.responseMetadata, [
      ['claimed_complete', 'claimedComplete', Boolean],
      ['reported_blocker', 'reportedBlocker', Boolean],
      ['response_length', 'responseLength', (value) => boundedInteger(value, 0, 0, 1_000_000)],
    ]),
    changed_files: sanitizeList(input.changedFiles, 100),
    verification: sanitizeList(input.verification, 50),
    deterministic_evidence: sanitizeText(input.deterministicEvidence || {}, MAX_TEXT),
    unresolved_errors: sanitizeList(input.unresolvedErrors, 20),
  };
}

function buildJevPayload(state, model = DEFAULT_MODEL) {
  return { model, state: compactJevState(state), questions: QUESTIONS };
}

function numberBetween(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function probabilitiesValid(probabilities, keys) {
  if (!probabilities || typeof probabilities !== 'object') return false;
  if (!keys.every((key) => numberBetween(probabilities[key], 0, 1))) return false;
  const sum = keys.reduce((total, key) => total + probabilities[key], 0);
  return Math.abs(sum - 1) <= 0.03;
}

function validateNoulAnswers(answers) {
  for (const id of ['task_complete', 'obvious_implied_work_remaining', 'verification_sufficient', 'scope_creep']) {
    const answer = answers[id];
    if (!answer || answer.type !== 'noul' || !numberBetween(answer.noul, 0, 1)) {
      throw new Error(`invalid Noul answer: ${id}`);
    }
  }
}

function validateScoreAnswer(score) {
  const valid = score?.type === 'score' &&
    numberBetween(score.score, 0, 3) &&
    numberBetween(score.confidence, 0, 1) &&
    probabilitiesValid(score.probabilities, ['0', '1', '2', '3']);
  if (!valid) throw new Error('invalid Score answer: completion_confidence');
}

function validateChoiceAnswer(choice) {
  const options = Object.keys(QUESTIONS.recommended_next_step.criteria);
  const valid = choice?.type === 'choice' &&
    options.includes(choice.choice) &&
    numberBetween(choice.confidence, 0, 1) &&
    probabilitiesValid(choice.probabilities, options);
  if (!valid) throw new Error('invalid Choice answer: recommended_next_step');
}

function parseJevResponse(body) {
  const answers = body?.answers;
  if (!answers || typeof answers !== 'object') throw new Error('missing answers');
  validateNoulAnswers(answers);
  validateScoreAnswer(answers.completion_confidence);
  validateChoiceAnswer(answers.recommended_next_step);
  return {
    model: String(body.model || ''),
    usage: body.usage || null,
    answers,
  };
}

function isHardIncomplete(answers, thresholds) {
  return answers.task_complete.noul <= 1 - thresholds.incomplete ||
    answers.obvious_implied_work_remaining.noul >= thresholds.incomplete ||
    answers.verification_sufficient.noul <= thresholds.verification ||
    answers.scope_creep.noul >= thresholds.scope;
}

function isStronglyComplete(answers, thresholds) {
  return answers.task_complete.noul >= thresholds.complete &&
    answers.obvious_implied_work_remaining.noul <= 1 - thresholds.complete &&
    answers.verification_sufficient.noul >= thresholds.complete &&
    answers.scope_creep.noul <= 1 - thresholds.complete &&
    answers.completion_confidence.score >= thresholds.confidence &&
    answers.recommended_next_step.choice === 'stop' &&
    answers.recommended_next_step.probabilities.stop >= thresholds.complete;
}

function decideJev(parsed, overrides = {}) {
  const thresholds = {
    complete: overrides.complete ?? 0.8,
    incomplete: overrides.incomplete ?? 0.65,
    verification: overrides.verification ?? 0.45,
    scope: overrides.scope ?? 0.65,
    confidence: overrides.confidence ?? 2.5,
  };
  const answers = parsed.answers;
  const hardIncomplete = isHardIncomplete(answers, thresholds);
  const stronglyComplete = isStronglyComplete(answers, thresholds);
  return {
    verdict: hardIncomplete ? 'continue' : stronglyComplete ? 'stop' : 'ambiguous',
    model: parsed.model,
    usage: parsed.usage,
    answers: {
      task_complete: answers.task_complete.noul,
      obvious_implied_work_remaining: answers.obvious_implied_work_remaining.noul,
      verification_sufficient: answers.verification_sufficient.noul,
      scope_creep: answers.scope_creep.noul,
      completion_confidence: {
        score: answers.completion_confidence.score,
        probabilities: answers.completion_confidence.probabilities,
      },
      recommended_next_step: {
        choice: answers.recommended_next_step.choice,
        probabilities: answers.recommended_next_step.probabilities,
      },
    },
  };
}

async function requestJev(fetchImpl, endpoint, requestOptions, controller) {
  try {
    const response = await fetchImpl(endpoint, { ...requestOptions, signal: controller.signal });
    if (!response.ok) return { kind: 'http', status: response.status };
    return { kind: 'success', parsed: parseJevResponse(await response.json()) };
  } catch (_) {
    return { kind: controller.signal.aborted ? 'timeout' : 'error' };
  }
}

function firstConfigured(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function resolveJevConfig(options) {
  const env = options.env || process.env;
  if (!truthy(env.PONYTAIL_ON_STIMULANTS_JEV_ENABLED) || !env.TYPESAFE_API_KEY) return null;
  const fetchImpl = firstConfigured(options.fetchImpl, globalThis.fetch);
  if (typeof fetchImpl !== 'function') return null;
  return {
    env,
    fetchImpl,
    endpoint: firstConfigured(options.endpoint, env.PONYTAIL_ON_STIMULANTS_JEV_ENDPOINT, DEFAULT_ENDPOINT),
    model: firstConfigured(options.model, env.PONYTAIL_ON_STIMULANTS_JEV_MODEL, DEFAULT_MODEL),
    timeoutMs: boundedInteger(
      firstConfigured(options.timeoutMs, env.PONYTAIL_ON_STIMULANTS_JEV_TIMEOUT_MS),
      DEFAULT_TIMEOUT_MS,
      1,
      10_000,
    ),
    retries: boundedInteger(firstConfigured(options.retries, env.PONYTAIL_ON_STIMULANTS_JEV_RETRIES), 0, 0, 1),
  };
}

function createJevJudge(options = {}) {
  const config = resolveJevConfig(options);
  if (!config) return null;
  const { env, fetchImpl, endpoint, model, timeoutMs, retries } = config;
  return async function judge(state) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const finish = (result) => ({ ...result, latencyMs: Date.now() - started });
    const requestOptions = {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildJevPayload(state, model)),
    };
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const result = await requestJev(fetchImpl, endpoint, requestOptions, controller);
        if (result.kind === 'success') return finish(decideJev(result.parsed, options.thresholds));
        if (result.kind === 'timeout') return finish({ verdict: 'unavailable', reason: 'timeout' });
        const retryable = result.kind === 'http' && (result.status === 429 || result.status === 529);
        if (attempt < retries && (retryable || result.kind === 'error')) continue;
        const reason = result.kind === 'http' ? `http_${result.status}` : 'transport_or_malformed';
        return finish({ verdict: 'unavailable', reason });
      }
      return finish({ verdict: 'unavailable', reason: 'unknown' });
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = {
  DEFAULT_ENDPOINT,
  QUESTIONS,
  buildJevPayload,
  compactJevState,
  createJevJudge,
  decideJev,
  parseJevResponse,
};
