#!/usr/bin/env node
// File-hook completion gate for Claude Code and Codex.
//
// Tracks tool evidence across hook processes, then on Stop uses the shared
// completion-gate decision to continue the turn. This is not Pi's in-process
// agent_end follow-up: Claude injects additionalContext; Codex blocks stop and
// turns `reason` into a continuation prompt. Fail-open always.

const {
  createSpawnExec,
  isContinuationPrompt,
  recordToolCall,
  recordToolResult,
  runCompletionDecision,
} = require('../completion-gate');
const { loadTurnState, resetTurnState, saveTurnState, turnStatePath } = require('../completion-gate/persist');
const { getDefaultMode } = require('./ponytail-on-stimulants-config');
const { readMode, stateDir, writeStopContinuation } = require('./ponytail-on-stimulants-runtime');

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
  recordToolResult(state, toolName(data), toolArgs(data), isError, toolCallId(data));
  saveTurnState(file, state);
}

async function handleStop(data) {
  const mode = currentMode();
  if (!mode || mode === 'off' || mode === 'focused') return;
  const file = turnFile(data);
  const state = loadTurnState(file);
  const decision = await runCompletionDecision({
    mode,
    state,
    exec: createSpawnExec(),
    cwd: cwd(data),
  });
  if (!decision) {
    saveTurnState(file, state);
    return;
  }
  saveTurnState(file, state);
  writeStopContinuation(eventName(data) || 'Stop', decision.prompt);
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
setTimeout(() => { finish(); }, 1000).unref();
