'use strict';

// One line per settled turn in an append-only TSV that people and tools can
// grep: time, harness, project, branch, session, stats, "ask → outcome".
// Deterministic (no model call) and fail-open like the rest of the gate.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isContinuationPrompt, redact, summarizeTrackedEvidence } = require('./index');
const { getRecapEnabled, getRecapPath } = require('../hooks/ponytail-on-stimulants-config');

const ASK_LIMIT = 80;
const OUTCOME_LIMIT = 160;

function oneLine(text, limit) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+)/, '').replace(/\*\*|__|`/g, '').trim())
    .find(Boolean) || '';
  const clean = redact(line).replace(/\s+/g, ' ').trim();
  const sentence = clean.match(/^.{10,}?[.!?](?=\s|$)/);
  if (sentence && sentence[0].length <= limit) return sentence[0];
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function displayPath(directory) {
  const home = os.homedir();
  const value = String(directory || '-');
  return home && (value === home || value.startsWith(home + path.sep)) ? `~${value.slice(home.length)}` : value;
}

async function gitSummary(exec, cwd) {
  if (typeof exec !== 'function' || !cwd) return { branch: '-', dirty: 0 };
  async function git(args) {
    try {
      return await exec('git', args, { cwd, timeout: 3000 });
    } catch (_) {
      return { code: 1, stdout: '' };
    }
  }
  const [branch, status] = await Promise.all([
    git(['symbolic-ref', '--short', '-q', 'HEAD']),
    git(['status', '--porcelain']),
  ]);
  if (status.code !== 0) return { branch: '-', dirty: 0 };
  const name = branch.code === 0 ? String(branch.stdout || '').trim() : '';
  const head = name ? null : await git(['rev-parse', '--short', 'HEAD']);
  const sha = head && head.code === 0 ? String(head.stdout || '').trim() : '';
  return {
    branch: name || (sha ? `@${sha}` : '-'),
    dirty: String(status.stdout || '').split(/\r?\n/).filter(Boolean).length,
  };
}

function formatRecap({ time, harness, project, branch, session, stats, ask, outcome }) {
  const summary = outcome ? `${ask} → ${outcome}` : ask;
  return [time, harness, project, branch, session, stats, summary]
    .map((field) => String(field || '-').replace(/[\t\r\n]+/g, ' '))
    .join('\t');
}

async function recordRecap({ harness, cwd, session, state, reply, exec, now = new Date() }) {
  if (!state || state.recapped || isContinuationPrompt(state.prompt) || !getRecapEnabled()) return null;
  const ask = oneLine(state.prompt, ASK_LIMIT);
  if (!ask) return null;
  state.recapped = true;
  const tracked = summarizeTrackedEvidence(state);
  const git = await gitSummary(exec, cwd);
  const line = formatRecap({
    time: now.toISOString().slice(0, 19) + 'Z',
    harness,
    project: displayPath(cwd),
    branch: git.branch,
    session: String(session || 'default').slice(0, 16),
    stats: `dirty=${git.dirty} tools=${tracked.toolCalls} errors=${tracked.toolErrors.length}`,
    ask,
    outcome: oneLine(reply, OUTCOME_LIMIT),
  });
  try {
    const file = getRecapPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + '\n');
    return line;
  } catch (_) {
    return null;
  }
}

module.exports = { formatRecap, gitSummary, oneLine, recordRecap };
