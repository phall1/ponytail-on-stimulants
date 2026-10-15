#!/usr/bin/env node
// Ponytail on Stimulants — removes state the fork wrote outside its own files:
// mode flags, config, the statusLine entry it added to
// settings.json, and its entries in ~/.cursor/hooks.json. Plugin files
// themselves are removed by each host's own uninstall command (see README);
// this only cleans up what those commands can't see.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getConfigPath, getClaudeDir } = require('../hooks/ponytail-on-stimulants-config');
const cursorHooks = require('./cursor-hooks');

const STATUSLINE_SCRIPT = /(?:^|[\\/])ponytail-on-stimulants-statusline\.(?:sh|ps1)(?=["'\s]|$)/;
const OWN_STATUSLINE = /^(?:(?:bash|sh)\s+|(?:pwsh|powershell)(?:\s+-ExecutionPolicy\s+Bypass)?(?:\s+-File)?\s+)?(?:"[^";&|`$\r\n]*ponytail-on-stimulants-statusline\.(?:sh|ps1)"|'[^';&|`$\r\n]*ponytail-on-stimulants-statusline\.(?:sh|ps1)'|[^\s"';&|`$]+ponytail-on-stimulants-statusline\.(?:sh|ps1))$/;

function remainingStatusline(command) {
  const trimmed = command.trim();
  if (STATUSLINE_SCRIPT.test(trimmed) && OWN_STATUSLINE.test(trimmed)) return '';
  // Only the simple && form we document is safe to split without a shell parser.
  // Preserve semicolons, quoting, substitutions, pipes and mixed operators verbatim.
  const parts = trimmed.split(' && ');
  if (parts.length < 2 || /[^\w\s~./\\:&-]/.test(trimmed)) return null;
  if (parts.some((part) => /[&]/.test(part))) return null;
  return parts.filter((part) => !(STATUSLINE_SCRIPT.test(part) && OWN_STATUSLINE.test(part))).join(' && ');
}

function removeIfExists(filePath, label) {
  try {
    fs.unlinkSync(filePath);
    console.log(`Removed ${label}: ${filePath}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

const persist = require('../completion-gate/persist');

function removeTurnFiles(directory, label) {
  for (const file of persist.listTurnStateFiles(directory)) {
    removeIfExists(file, label);
  }
}

removeIfExists(path.join(getClaudeDir(), '.ponytail-on-stimulants-active'), 'Ponytail on Stimulants mode flag');
removeIfExists(path.join(getClaudeDir(), '.ponytail-on-stimulants-statusline-nudged'), 'Ponytail on Stimulants statusline nudge flag');
removeTurnFiles(getClaudeDir(), 'Ponytail on Stimulants Claude/Codex turn state');
removeIfExists(path.join(os.homedir(), '.cursor', '.ponytail-on-stimulants-active'), 'Ponytail on Stimulants Cursor mode flag');
removeTurnFiles(path.join(os.homedir(), '.cursor'), 'Ponytail on Stimulants Cursor turn state');
for (const directory of [process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder'), process.env.PLUGIN_DATA, process.env.COPILOT_PLUGIN_DATA].filter(Boolean)) {
  removeTurnFiles(directory, 'Ponytail on Stimulants turn state');
  removeIfExists(path.join(directory, '.ponytail-on-stimulants-active'), 'Ponytail on Stimulants mode flag');
}
removeIfExists(
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', '.ponytail-on-stimulants-active'),
  'Ponytail on Stimulants OpenCode mode flag',
);
removeIfExists(getConfigPath(), 'Ponytail on Stimulants config file');

// Cursor hooks (#817): drop only Ponytail on Stimulants entries from ~/.cursor/hooks.json,
// keep every other hook the user configured there.
try {
  const hooksFile = cursorHooks.uninstall('user');
  if (hooksFile) console.log(`Removed Ponytail on Stimulants hooks from ${hooksFile}`);
} catch (e) {
  if (e instanceof SyntaxError) {
    // ponytail-on-stimulants: malformed hooks.json — can't safely edit it; leave intact, warn
    console.warn(`~/.cursor/hooks.json is malformed — could not remove the Ponytail on Stimulants hook entries. Remove them manually from: ${cursorHooks.hooksPath('user')} (${e.message})`);
  } else {
    throw e;
  }
}

const settingsPath = path.join(getClaudeDir(), 'settings.json');
try {
  const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
  const settings = JSON.parse(raw);
  const cmd = settings.statusLine && settings.statusLine.command;
  if (typeof cmd === 'string' && STATUSLINE_SCRIPT.test(cmd)) {
    const remaining = remainingStatusline(cmd);
    if (remaining === null) {
      console.warn(`Preserved complex statusLine command in ${settingsPath}; remove the Ponytail on Stimulants segment manually.`);
    } else if (remaining !== cmd) {
      if (remaining) settings.statusLine.command = remaining;
      else delete settings.statusLine;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      console.log(`Removed Ponytail on Stimulants statusLine segment from ${settingsPath}`);
    }
  }
} catch (e) {
  if (e.code === 'ENOENT') {
    // no settings.json — nothing to clean
  } else if (e instanceof SyntaxError) {
    // ponytail-on-stimulants: malformed settings.json — can't safely edit it; leave intact, warn
    console.warn(`settings.json is malformed — could not remove the Ponytail on Stimulants statusLine entry. Remove it manually from: ${settingsPath} (${e.message})`);
  } else {
    throw e;
  }
}
