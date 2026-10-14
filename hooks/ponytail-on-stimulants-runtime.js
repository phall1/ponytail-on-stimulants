const fs = require('fs');
const path = require('path');
const os = require('os');
const { getClaudeDir, normalizeMode } = require('./ponytail-on-stimulants-config');

const STATE_FILE = '.ponytail-on-stimulants-active';

function isVsCodeCopilotRoot(pluginRoot) {
  if (!pluginRoot) return false;
  return pluginRoot.split(/[\\/]+/).includes('agent-plugins') &&
    pluginRoot.toLowerCase().includes('.vscode');
}

const isCopilot = Boolean(process.env.COPILOT_PLUGIN_DATA) ||
  isVsCodeCopilotRoot(process.env.CLAUDE_PLUGIN_ROOT);
const isCodex = !isCopilot && Boolean(process.env.PLUGIN_DATA);
const isQoder = !isCopilot && !isCodex && Boolean(
  process.env.QODER_SESSION_ID || process.env.QODER_PLUGIN_ROOT || process.env.QODER_PLUGIN_DATA,
);
const isCursor = !isCopilot && !isCodex && !isQoder && Boolean(process.env.CURSOR_VERSION);

let stateDir = getClaudeDir();
if (isCodex) stateDir = process.env.PLUGIN_DATA;
if (isCopilot) stateDir = process.env.COPILOT_PLUGIN_DATA || getClaudeDir();
if (isQoder) stateDir = process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder');
if (isCursor) stateDir = path.join(os.homedir(), '.cursor');

const statePath = path.join(stateDir, STATE_FILE);

function setMode(mode) {
  const normalized = normalizeMode(mode);
  if (!normalized) return false;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, normalized);
  return true;
}

function clearMode() {
  try { fs.unlinkSync(statePath); } catch (_) {}
}

function readMode() {
  try {
    return normalizeMode(fs.readFileSync(statePath, 'utf8').trim());
  } catch (_) {
    return null;
  }
}

function cursorRulePath() {
  const root = process.env.CURSOR_PROJECT_DIR || process.cwd();
  const rule = path.join(root, '.cursor', 'rules', 'ponytail-on-stimulants.mdc');
  return fs.existsSync(rule) ? rule : null;
}

function cursorRuleNotice(rule) {
  return 'PONYTAIL ON STIMULANTS: the always-on Cursor rule ' + rule + ' is active and already ' +
    'carries the ruleset, so hooks injected nothing. Mode switching is unavailable while that ' +
    'rule exists; delete it to let hooks.json manage focused/full-send/feral/off.';
}

// Hook callers exit immediately; async pipe writes can be truncated at exit.
function writeOut(text) {
  fs.writeSync(1, text);
}

function writeJson(output) {
  writeOut(JSON.stringify(output));
}

function writeCodexOutput(event, context) {
  // Codex renders systemMessage as a warning; deliver context without it.
  const output = {};
  if (context) output.hookSpecificOutput = { hookEventName: event, additionalContext: context };
  writeJson(output);
}

function writeCursorOutput(event, context) {
  // Native beforeSubmitPrompt cannot inject context; mode changes apply at
  // the next sessionStart, the only supported context-delivery event.
  if (event === 'UserPromptSubmit') return writeJson({ continue: true });
  if (event === 'SessionStart' && context) return writeJson({ additional_context: context });
}

function writeHookOutput(event, mode, context = '') {
  if (isCopilot) return writeJson(context ? { additionalContext: context } : {});
  if (isCodex) return writeCodexOutput(event, context);
  if (isQoder) {
    return writeJson(context ? { hookSpecificOutput: { hookEventName: event, additionalContext: context } } : {});
  }
  if (isCursor) return writeCursorOutput(event, context);
  if (event === 'SubagentStart') {
    return writeJson({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
  }
  writeOut(context);
}

function writeStopContinuation(event, prompt) {
  if (!prompt) return;
  if (isCodex) {
    // Codex Stop continuation is a new user prompt built from decision/reason.
    return writeJson({ decision: 'block', reason: prompt });
  }
  return writeJson({
    hookSpecificOutput: {
      hookEventName: event || 'Stop',
      additionalContext: prompt,
    },
  });
}

module.exports = {
  STATE_FILE,
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodex,
  isCopilot,
  isCursor,
  isQoder,
  readMode,
  setMode,
  stateDir,
  writeHookOutput,
  writeStopContinuation,
};
