#!/usr/bin/env node
// UserPromptSubmit hook: track Ponytail on Stimulants mode and inject where needed.

const {
  getDefaultMode,
  isDeactivationCommand,
  normalizeMode,
  writeDefaultMode,
} = require('./ponytail-on-stimulants-config');
const {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCursor,
  isQoder,
  readMode,
  setMode,
  writeHookOutput,
} = require('./ponytail-on-stimulants-runtime');
const { getPonytailInstructions } = require('./ponytail-on-stimulants-instructions');

let input = '';
let done = false;
const COMMANDS = new Set([
  '/ponytail-on-stimulants',
  '/ponytail-on-stimulants:ponytail-on-stimulants',
]);

function commandParts(prompt) {
  const parts = prompt.split(/\s+/);
  parts[0] = parts[0].replace(/^[@$]/, '/');
  return parts;
}

function parsePrompt() {
  const data = JSON.parse(input.replace(/^\uFEFF/, ''));
  const prompt = String(data.prompt || '').trim().toLowerCase();
  const [command, argument = '', defaultArgument = ''] = commandParts(prompt);
  return {
    prompt,
    command,
    argument,
    defaultArgument,
    isCommand: COMMANDS.has(command),
  };
}

function emitCursorRuleNotice(context) {
  if (!isCursor || (!context.isCommand && !isDeactivationCommand(context.prompt))) return false;
  const rule = cursorRulePath();
  if (!rule) return false;
  writeHookOutput('UserPromptSubmit', readMode() || 'off', cursorRuleNotice(rule));
  return true;
}

function deactivate() {
  if (isCursor) clearMode();
  else setMode('off');
  writeHookOutput('UserPromptSubmit', 'off', 'PONYTAIL ON STIMULANTS MODE OFF');
  return { modeSwitched: false, deactivated: true };
}

function writeDefault(argument) {
  const written = writeDefaultMode(argument);
  if (written) {
    writeHookOutput(
      'UserPromptSubmit',
      written,
      `PONYTAIL ON STIMULANTS DEFAULT SET — new sessions start in ${written}.`,
    );
  }
}

function requestedMode(context) {
  if (!context.argument || context.argument === 'status') {
    return { mode: readMode() || getDefaultMode(), reportOnly: true };
  }
  return { mode: normalizeMode(context.argument), reportOnly: false };
}

function reportMode(mode) {
  writeHookOutput(
    'UserPromptSubmit',
    mode,
    `PONYTAIL ON STIMULANTS ACTIVE — mode: ${mode}`,
  );
  return { modeSwitched: false, deactivated: false };
}

function activateMode(mode) {
  setMode(mode);
  if (!isQoder) {
    const header = `PONYTAIL ON STIMULANTS MODE CHANGED — mode: ${mode}`;
    writeHookOutput('UserPromptSubmit', mode, `${header}\n\n${getPonytailInstructions(mode)}`);
  }
  return { modeSwitched: true, deactivated: false };
}

function handleCommand(context) {
  if (!context.isCommand) return { modeSwitched: false, deactivated: false };
  if (context.argument === 'default') {
    writeDefault(context.defaultArgument);
    return { terminal: true, modeSwitched: false, deactivated: false };
  }
  const { mode, reportOnly } = requestedMode(context);
  if (reportOnly) return reportMode(mode);
  if (mode === 'off') return deactivate();
  if (mode) return activateMode(mode);
  return { modeSwitched: false, deactivated: false };
}

function ensureQoderMode() {
  const persisted = readMode();
  if (persisted) return persisted;
  const configured = getDefaultMode();
  if (configured !== 'off') setMode(configured);
  return configured;
}

function injectQoder(modeSwitched) {
  if (!isQoder) return;
  const currentMode = ensureQoderMode();
  if (!currentMode || currentMode === 'off') return;
  const header = modeSwitched
    ? `PONYTAIL ON STIMULANTS MODE CHANGED — mode: ${currentMode}\n\n`
    : '';
  writeHookOutput('UserPromptSubmit', currentMode, header + getPonytailInstructions(currentMode));
}

function processPrompt() {
  const context = parsePrompt();
  if (emitCursorRuleNotice(context)) return;
  let state = handleCommand(context);
  if (state.terminal) return;
  if (!state.modeSwitched && !state.deactivated && isDeactivationCommand(context.prompt)) {
    state = deactivate();
  }
  if (!state.deactivated) injectQoder(state.modeSwitched);
}

function finish() {
  if (done) return;
  done = true;
  try {
    processPrompt();
  } catch (_) {
    // Hooks are best effort and must never block a session.
  }
}

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', finish);
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000).unref();
