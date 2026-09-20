const fs = require('fs');
const path = require('path');
const os = require('os');
const { getClaudeDir, normalizePersistedMode } = require('./ponytail-on-stimulants-config');

const STATE_FILE = '.ponytail-on-stimulants-active';

function isVsCodeCopilotRoot(pluginRoot) {
  if (!pluginRoot) return false;
  return pluginRoot.split(/[\\/]+/).includes('agent-plugins') &&
    pluginRoot.toLowerCase().includes('.vscode');
}

const isCopilot = Boolean(process.env.COPILOT_PLUGIN_DATA) ||
  isVsCodeCopilotRoot(process.env.CLAUDE_PLUGIN_ROOT);
const isCodex = !isCopilot && Boolean(process.env.PLUGIN_DATA);
const isQoder = !isCopilot && !isCodex && Boolean(process.env.QODER_SESSION_ID);
const isCursor = !isCopilot && !isCodex && !isQoder && Boolean(process.env.CURSOR_VERSION);

let stateDir = getClaudeDir();
if (isCodex) stateDir = process.env.PLUGIN_DATA;
if (isCopilot) stateDir = process.env.COPILOT_PLUGIN_DATA || getClaudeDir();
if (isQoder) stateDir = path.join(os.homedir(), '.qoder');
if (isCursor) stateDir = path.join(os.homedir(), '.cursor');

const statePath = path.join(stateDir, STATE_FILE);

function setMode(mode) {
  const normalized = normalizePersistedMode(mode);
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
    return normalizePersistedMode(fs.readFileSync(statePath, 'utf8').trim());
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

function writeJson(output) {
  process.stdout.write(JSON.stringify(output));
}

function writeCodexOutput(event, mode, context) {
  const output = { systemMessage: `PONYTAIL_ON_STIMULANTS:${String(mode).toUpperCase()}` };
  if (context) output.hookSpecificOutput = { hookEventName: event, additionalContext: context };
  writeJson(output);
}

function writeCursorOutput(event, context) {
  if (!context) return;
  const output = { additional_context: context };
  if (event === 'UserPromptSubmit') output.continue = true;
  writeJson(output);
}

function writeHookOutput(event, mode, context = '') {
  if (isCopilot) return writeJson(context ? { additionalContext: context } : {});
  if (isCodex) return writeCodexOutput(event, mode, context);
  if (isQoder) {
    return writeJson(context ? { hookSpecificOutput: { hookEventName: event, additionalContext: context } } : {});
  }
  if (isCursor) return writeCursorOutput(event, context);
  if (event === 'SubagentStart') {
    return writeJson({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
  }
  process.stdout.write(context);
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
  writeHookOutput,
};
