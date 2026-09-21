'use strict';

const crypto = require('crypto');

const MODE_POLICIES = Object.freeze({
  off: { maxContinuations: 0 },
  focused: { maxContinuations: 0 },
  'full-send': { maxContinuations: 1 },
  feral: { maxContinuations: 2 },
});

const MUTATION_TOOLS = new Set(['edit', 'write']);
const SEARCH_TOOLS = new Set(['grep', 'find', 'read', 'ls']);
const EXECUTION_WORDS = /\b(add|address|build|change|complete|configure|create|debug|delete|disable|enable|finish|fix|handle|implement|install|make|migrate|modify|refactor|remove|rename|repair|resolve|rework|run|ship|support|take care of|test|update|upgrade|verify|write)\b/i;
const INFORMATIONAL_ONLY = /^\s*(explain|how|what|when|where|which|who|why)\b/i;
const TODO_PATTERN = /^\+[^+].*\b(TODO|FIXME|XXX|HACK)\b/im;
const TODO_TEXT = /\b(TODO|FIXME|XXX|HACK)\b/i;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fingerprintTool(toolName, args) {
  return `${toolName}:${hash(stableStringify(args || {}))}`;
}

function redact(value) {
  return String(value || '')
    .replace(/(["']?[a-z0-9_-]*(?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1[redacted]')
    .replace(/(--?[a-z0-9_-]*(?:api[_-]?key|token|password|secret))\s+(?:"[^"]*"|'[^']*'|\S+)/gi, '$1 [redacted]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:gh[pousr]_[a-z0-9_]{20,}|sk-[a-z0-9_-]{16,})\b/gi, '[redacted]');
}

function actionSummary(toolName, args = {}) {
  const value = toolName === 'bash' ? args.command :
    toolName === 'grep' ? `${args.pattern || ''} ${args.path || ''}`.trim() :
    args.path || args.file_path || '';
  return redact(value).slice(0, 300);
}

function isExecutionPrompt(text) {
  const prompt = String(text || '').trim();
  if (!prompt || INFORMATIONAL_ONLY.test(prompt)) return false;
  return EXECUTION_WORDS.test(prompt);
}

function createTurnState(prompt = '') {
  return {
    prompt: String(prompt || ''),
    acceptedExecution: isExecutionPrompt(prompt),
    continuations: 0,
    toolCalls: 0,
    hadMutation: false,
    recentTools: [],
    pendingTools: new Map(),
    fingerprints: new Map(),
    failureCounts: new Map(),
    unresolvedFailures: new Map(),
    lastPrompt: null,
  };
}

function recordToolCall(state, toolName, args, toolCallId) {
  if (!state) return null;
  const fingerprint = fingerprintTool(toolName, args);
  const entry = {
    tool: toolName,
    action: actionSummary(toolName, args),
    fingerprint,
    status: 'pending',
  };
  state.toolCalls += 1;
  state.recentTools.push(entry);
  if (state.recentTools.length > 20) state.recentTools.shift();
  if (toolCallId) state.pendingTools.set(toolCallId, { args, entry });
  if (MUTATION_TOOLS.has(toolName)) state.hadMutation = true;
  state.fingerprints.set(fingerprint, (state.fingerprints.get(fingerprint) || 0) + 1);
  return fingerprint;
}

function resolveToolResult(state, toolName, args, toolCallId) {
  const pending = toolCallId ? state.pendingTools.get(toolCallId) : null;
  const resolvedArgs = pending?.args || args || {};
  const fingerprint = fingerprintTool(toolName, resolvedArgs);
  const entry = pending?.entry || [...state.recentTools].reverse()
    .find((item) => item.fingerprint === fingerprint && item.status === 'pending');
  if (toolCallId) state.pendingTools.delete(toolCallId);
  return { entry, fingerprint, resolvedArgs };
}

function recordToolResult(state, toolName, args, isError, toolCallId) {
  if (!state) return;
  const { entry, fingerprint, resolvedArgs } = resolveToolResult(state, toolName, args, toolCallId);
  if (entry) entry.status = isError ? 'failed' : 'passed';
  if (!isError) {
    state.unresolvedFailures.delete(fingerprint);
    return;
  }
  const failure = { tool: toolName, action: actionSummary(toolName, resolvedArgs), fingerprint };
  state.unresolvedFailures.set(fingerprint, failure);
  state.failureCounts.set(fingerprint, (state.failureCounts.get(fingerprint) || 0) + 1);
}

function summarizeTrackedEvidence(state) {
  const repeatedActions = [...state.fingerprints.entries()]
    .filter(([, count]) => count > 1)
    .map(([fingerprint, count]) => ({ fingerprint, count }));
  const repeatedFailures = [...state.failureCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([fingerprint, count]) => ({ fingerprint, count }));
  return {
    acceptedExecution: state.acceptedExecution,
    hadMutation: state.hadMutation,
    toolCalls: state.toolCalls,
    toolErrors: [...state.unresolvedFailures.values()].slice(-8),
    recentTools: state.recentTools.slice(-20),
    repeatedActions: repeatedActions.slice(-8),
    repeatedFailures: repeatedFailures.slice(-8),
  };
}

function emptyGitEvidence() {
  return {
    available: false,
    changedFiles: [],
    diffCheckFailed: false,
    introducedTodos: [],
    errors: [],
  };
}

function recordStatus(evidence, status) {
  if (status.code !== 0) {
    evidence.errors.push('git status failed');
    return;
  }
  evidence.changedFiles = String(status.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .slice(0, 100);
}

function recordDiffChecks(evidence, checks) {
  for (const check of checks) {
    if (check.code === 0) continue;
    evidence.diffCheckFailed = true;
    evidence.errors.push(String(check.stderr || check.stdout || 'git diff --check failed').trim().slice(0, 500));
  }
}

function trackedTodos(diffs) {
  const todos = [];
  for (const diff of diffs.filter((item) => item.code === 0)) {
    for (const line of String(diff.stdout || '').split(/\r?\n/)) {
      if (TODO_PATTERN.test(`${line}\n`)) todos.push(line.slice(1).trim());
    }
  }
  return todos;
}

async function untrackedTodos(git, untracked, evidence) {
  if (untracked.code !== 0) {
    evidence.errors.push('git untracked-file scan failed');
    return [];
  }
  const paths = String(untracked.stdout || '').split(/\r?\n/).filter(Boolean).slice(0, 100);
  if (paths.length === 0) return [];
  const grep = await git(['grep', '--no-index', '-n', '-I', '-E', 'TODO|FIXME|XXX|HACK', '--', ...paths]);
  if (grep.code === 0) return String(grep.stdout || '').split(/\r?\n/).filter((line) => TODO_TEXT.test(line));
  if (grep.code > 1) evidence.errors.push('untracked TODO scan failed');
  return [];
}

async function collectGitEvidence(exec, cwd) {
  const evidence = emptyGitEvidence();
  if (typeof exec !== 'function') return evidence;

  async function git(args) {
    try {
      return await exec('git', args, { cwd, timeout: 5000 });
    } catch (error) {
      return { code: 1, stdout: '', stderr: String(error && error.message || error) };
    }
  }

  const inside = await git(['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || String(inside.stdout).trim() !== 'true') return evidence;
  evidence.available = true;
  const [status, worktreeCheck, stagedCheck, worktreeDiff, stagedDiff, untracked] = await Promise.all([
    git(['status', '--porcelain']),
    git(['diff', '--check']),
    git(['diff', '--cached', '--check']),
    git(['diff', '--unified=0', '--no-ext-diff']),
    git(['diff', '--cached', '--unified=0', '--no-ext-diff']),
    git(['ls-files', '--others', '--exclude-standard']),
  ]);
  recordStatus(evidence, status);
  recordDiffChecks(evidence, [worktreeCheck, stagedCheck]);
  const todos = trackedTodos([worktreeDiff, stagedDiff]);
  todos.push(...await untrackedTodos(git, untracked, evidence));
  evidence.introducedTodos = [...new Set(todos)].slice(0, 20);
  return evidence;
}

function maxContinuations(mode) {
  return (MODE_POLICIES[mode] || MODE_POLICIES['full-send']).maxContinuations;
}

function shouldRunCompletionPass(mode, state, evidence = {}) {
  const maximum = maxContinuations(mode);
  if (!state || maximum === 0 || state.continuations >= maximum) return false;
  const tracked = evidence.tracked || summarizeTrackedEvidence(state);
  // A dirty worktree may predate this turn; never treat it alone as agent work.
  return Boolean(
    tracked.hadMutation ||
    (tracked.acceptedExecution && (tracked.toolCalls > 0 || (tracked.toolErrors || []).length > 0)),
  );
}

function compactEvidence(evidence) {
  const tracked = evidence.tracked || {};
  const git = evidence.git || {};
  return {
    git_available: Boolean(git.available),
    git_errors: (git.errors || []).slice(0, 5),
    changed_files: (git.changedFiles || []).slice(0, 30),
    diff_check_failed: Boolean(git.diffCheckFailed),
    introduced_todos: (git.introducedTodos || []).slice(0, 10),
    tool_error_count: (tracked.toolErrors || []).length,
    recent_actions: (tracked.recentTools || []).slice(-10),
    repeated_actions: (tracked.repeatedActions || []).slice(0, 5),
    repeated_failures: (tracked.repeatedFailures || []).slice(0, 5),
  };
}

function buildContinuationPrompt({ mode, pass, maximum, evidence, jev }) {
  const compact = compactEvidence(evidence);
  const lines = [
    `PONYTAIL ON STIMULANTS COMPLETION PASS ${pass}/${maximum} (${mode}).`,
    'Do not merely reaffirm completion. Inspect the repository and finish any directly necessary or mechanically implied work.',
    'Re-check callers and sibling paths, edge cases, generated/derived state, failed commands, relevant verification, the final diff, and accidental files.',
    `Deterministic evidence: ${JSON.stringify(compact)}`,
  ];
  if (jev && jev.verdict && jev.verdict !== 'unavailable') {
    lines.push(`Optional Jev judgment: ${JSON.stringify({ verdict: jev.verdict, answers: jev.answers })}`);
  }
  lines.push('If everything is truly complete, state the concrete evidence briefly. Otherwise perform the remaining work now. Keep scope bounded.');
  return lines.join('\n');
}

function claimContinuation(state, prompt, maximum) {
  if (!state || !prompt || state.lastPrompt === prompt) return false;
  if (!Number.isInteger(maximum) || maximum < 0 || state.continuations >= maximum) return false;
  state.continuations += 1;
  state.lastPrompt = prompt;
  return true;
}

module.exports = {
  MODE_POLICIES,
  SEARCH_TOOLS,
  buildContinuationPrompt,
  claimContinuation,
  collectGitEvidence,
  compactEvidence,
  createTurnState,
  fingerprintTool,
  isExecutionPrompt,
  maxContinuations,
  recordToolCall,
  recordToolResult,
  redact,
  shouldRunCompletionPass,
  summarizeTrackedEvidence,
};
