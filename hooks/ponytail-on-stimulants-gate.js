#!/usr/bin/env node
// File-hook completion gate for Claude Code and Codex.
//
// Tracks tool evidence across hook processes, then on Stop uses the shared
// completion-gate decision to continue the turn. This is not Pi's in-process
// agent_end follow-up: Claude injects additionalContext; Codex blocks stop and
// turns `reason` into a continuation prompt. A settled turn (no further
// pass) appends a one-line recap to the shared index. Fail-open always.

const fs = require('fs');

const {
  createSpawnExec,
  isContinuationPrompt,
  recordToolCall,
  recordToolResult,
  runCompletionDecision,
} = require('../completion-gate');
const { loadTurnState, resetTurnState, saveTurnState, turnStatePath } = require('../completion-gate/persist');
const { recordRecap, rememberAnswer } = require('../completion-gate/recap');
const { getDefaultMode } = require('./ponytail-on-stimulants-config');
const { harnessName, isCodex, readMode, stateDir, writeStopContinuation } = require('./ponytail-on-stimulants-runtime');

let input = '';
let done = false;

function sessionId(data) {
  return data.session_id || data.sessionId || data.turn_id || 'default';
}

function eventName(data) {
  return String(data.hook_event_name || data.hookEventName || '').trim();
}

function toolName(data) {
  return data.tool_name || data.toolName || data.tool || 'unknown';
}

function toolArgs(data) {
  return data.tool_input || data.toolInput || data.args || {};
}

function toolCallId(data) {
  return data.tool_use_id || data.toolCallId || data.call_id || data.callID || null;
}

function promptText(data) {
  return String(data.prompt || data.last_assistant_message || data.lastAssistantMessage || '');
}

function cwd(data) {
  return data.cwd || process.cwd();
}

function currentMode() {
  return readMode() || getDefaultMode();
}

function turnFile(data) {
  return turnStatePath(stateDir, sessionId(data));
}

function handleUserPrompt(data) {
  const prompt = promptText(data);
  if (isContinuationPrompt(prompt) || data.stop_hook_active) return;
  resetTurnState(turnFile(data), prompt);
}

function handleToolStart(data) {
  const file = turnFile(data);
  const state = loadTurnState(file);
  recordToolCall(state, toolName(data), toolArgs(data), toolCallId(data));
  saveTurnState(file, state);
}

function handleToolEnd(data, isError) {
  const file = turnFile(data);
  const state = loadTurnState(file);
  const outcome = isCodex && !isError ? null : isError;
  recordToolResult(state, toolName(data), toolArgs(data), outcome, toolCallId(data));
  saveTurnState(file, state);
}

async function handleStop(data) {
  const file = turnFile(data);
  const state = loadTurnState(file);
  const exec = createSpawnExec();
  const mode = currentMode();
  const decision = mode && mode !== 'off' && mode !== 'focused'
    ? await runCompletionDecision({ mode, state, exec, cwd: cwd(data) })
    : null;
  const reply = data.last_assistant_message || data.lastAssistantMessage || transcriptReply(data.transcript_path);
  if (decision) {
    rememberAnswer(state, reply);
    saveTurnState(file, state);
    writeStopContinuation(eventName(data) || 'Stop', decision.prompt);
    return;
  }
  await recordRecap({ harness: harnessName, cwd: cwd(data), session: sessionId(data), state, reply, exec });
  saveTurnState(file, state);
}

// Older Claude Code Stop payloads omit last_assistant_message; read only the
// transcript tail for the newest assistant text.
function transcriptReply(file) {
  if (!file) return '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, 256 * 1024);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8').split(/\r?\n/).reverse().map(assistantText).find(Boolean) || '';
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

function assistantText(line) {
  try {
    const entry = JSON.parse(line);
    const content = entry && entry.type === 'assistant' && entry.message && entry.message.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.filter((part) => part && part.type === 'text').map((part) => part.text || '').join('\n');
  } catch (_) {
    return '';
  }
}

async function dispatch(data) {
  const event = eventName(data);
  if (event === 'UserPromptSubmit') return handleUserPrompt(data);
  if (event === 'PreToolUse') return handleToolStart(data);
  if (event === 'PostToolUse') return handleToolEnd(data, false);
  if (event === 'PostToolUseFailure') return handleToolEnd(data, true);
  if (event === 'Stop') return handleStop(data);
}

async function processInput() {
  if (!input.trim()) return;
  let data;
  try {
    data = JSON.parse(input.replace(/^\uFEFF/, ''));
  } catch (_) {
    return;
  }
  if (!data || typeof data !== 'object') return;
  await dispatch(data);
}

function finish() {
  if (done) return;
  done = true;
  Promise.resolve()
    .then(processInput)
    .catch(() => {})
    .finally(() => process.exit(0));
}

process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', finish);
process.stdin.on('error', () => { finish(); });
setTimeout(() => { finish(); }, 1000);
