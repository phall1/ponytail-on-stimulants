#!/usr/bin/env node
// Ponytail on Stimulants — SessionStart activation hook for supported hosts.
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.ponytail-on-stimulants-active (defaults to ~/.claude; statusline reads this)
//   2. Emits Ponytail on Stimulants ruleset as hidden SessionStart context
//   3. Detects missing statusline config and emits setup nudge

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getClaudeDir, isShellSafe } = require('./ponytail-on-stimulants-config');
const { getPonytailInstructions } = require('./ponytail-on-stimulants-instructions');
const {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodex,
  isCopilot,
  isCursor,
  readMode,
  setMode,
  writeHookOutput,
} = require('./ponytail-on-stimulants-runtime');

const claudeDir = getClaudeDir();
const settingsPath = path.join(claudeDir, 'settings.json');

const resetMode = process.argv.includes('--reset');
const mode = resetMode ? getDefaultMode() : (readMode() || getDefaultMode());

// "off" mode — skip activation entirely, don't write flag or emit rules
if (mode === 'off') {
  if (resetMode || isCursor) clearMode();
  else setMode('off');
  const hookOutput = (isCodex || isCopilot || isCursor) ? '' : 'OK';
  writeHookOutput('SessionStart', 'off', hookOutput);
  process.exit(0);
}

// Cursor with the always-on rule in the workspace: the rule already carries the
// ruleset and would contradict any other level, so leave the flag alone and
// hand the model a one-line notice instead of a second copy (#817).
if (isCursor) {
  const rule = cursorRulePath();
  if (rule) {
    try {
      writeHookOutput('SessionStart', mode, cursorRuleNotice(rule));
    } catch (e) {
      // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
    }
    process.exit(0);
  }
}

// 1. Write flag file
try {
  setMode(mode);
} catch (e) {
  // Silent fail -- flag is best-effort, don't block the hook
}

// 2. Emit the Ponytail on Stimulants ruleset, filtered to the active intensity level.
let output = getPonytailInstructions(mode);

// 3. Detect missing statusline config — nudge Claude to help set it up
if (!isCodex && !isCopilot && !isCursor) try {
  let hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    // Strip UTF-8 BOM some editors prepend on Windows (breaks JSON.parse)
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(raw);
    if (settings.statusLine) {
      hasStatusline = true;
    }
  }

  // Nudge at most once — the flag file marks that the user has already seen
  // (and implicitly declined) the statusline setup offer. Repeating it every
  // session start turns a helpful hint into a nag.
  const nudgeFlagPath = path.join(claudeDir, '.ponytail-on-stimulants-statusline-nudged');
  if (!hasStatusline && !fs.existsSync(nudgeFlagPath)) {
    try { fs.writeFileSync(nudgeFlagPath, ''); } catch (e) { /* best-effort */ }
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'ponytail-on-stimulants-statusline.ps1' : 'ponytail-on-stimulants-statusline.sh';
    const scriptPath = path.join(__dirname, scriptName);
    if (isShellSafe(scriptPath)) {
      const command = isWindows
        ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
        : `bash "${scriptPath}"`;
      const statusLineSnippet =
        '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The Ponytail on Stimulants plugin includes a statusline badge showing active mode " +
        "(e.g. [PONYTAIL+], [PONYTAIL+:FERAL]). It is not configured yet. " +
        "To enable, add this to " + settingsPath + ": " +
        statusLineSnippet + " " +
        "Proactively offer to set this up for the user on first interaction.";
    } else {
      // ponytail-on-stimulants: install path has shell metacharacters — don't embed it in a
      // command snippet; have the agent wire it up by hand instead.
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The Ponytail on Stimulants plugin includes a statusline badge showing active mode. " +
        "Its install path contains characters unsafe to embed in a shell command, so configure it manually: " +
        "add a statusLine command of type \"command\" that runs " + scriptName +
        " from the plugin's hooks directory to " + settingsPath + ", quoting/escaping the path for your shell. " +
        "Proactively offer to set this up for the user on first interaction.";
    }
  }
} catch (e) {
  // Silent fail — don't block session start over statusline detection
}

try {
  writeHookOutput('SessionStart', mode, output);
} catch (e) {
  // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
}
