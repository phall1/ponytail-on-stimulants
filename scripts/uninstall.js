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

const STATUSLINE_SCRIPT = 'ponytail-on-stimulants-statusline';

function removeIfExists(filePath, label) {
  try {
    fs.unlinkSync(filePath);
    console.log(`Removed ${label}: ${filePath}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

removeIfExists(path.join(getClaudeDir(), '.ponytail-on-stimulants-active'), 'Ponytail on Stimulants mode flag');
removeIfExists(path.join(getClaudeDir(), '.ponytail-on-stimulants-statusline-nudged'), 'Ponytail on Stimulants statusline nudge flag');
removeIfExists(path.join(os.homedir(), '.cursor', '.ponytail-on-stimulants-active'), 'Ponytail on Stimulants Cursor mode flag');
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
  // Only remove the parts this fork owns. If the user combined statuslines,
  // keep every other plugin's command intact.
  // ponytail-on-stimulants: splits on && / ; to detect other segments — good enough; a user
  // piping statuslines together is on their own.
  if (typeof cmd === 'string' && cmd.includes(STATUSLINE_SCRIPT)) {
    const parts = cmd
      .split(/&&|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const others = parts.filter((s) => !s.includes(STATUSLINE_SCRIPT));
    if (others.length === 0) {
      delete settings.statusLine;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      console.log(`Removed Ponytail on Stimulants statusLine entry from ${settingsPath}`);
    } else {
      settings.statusLine.command = others.join(' && ');
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
