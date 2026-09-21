// Ponytail on Stimulants — OpenCode plugin.
//
// Injects the completion ruleset into every chat at the active mode, persists
// /ponytail-on-stimulants switches, and registers the fork's slash commands.
//
// OpenCode loads this as a server plugin — add it to your opencode.json:
//   { "plugin": ["ponytail-on-stimulants"] }

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The shared instruction builder is CommonJS; bridge to it from this ES module.
const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require('../../hooks/ponytail-on-stimulants-instructions');
const {
  getDefaultMode,
  normalizeMode,
  writeDefaultMode,
} = require('../../hooks/ponytail-on-stimulants-config');
const { parseCommandFile } = require('./ponytail-on-stimulants-frontmatter.cjs');

// OpenCode has no flag-file convention of its own; keep mode beside its config.
const statePath = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'opencode',
  '.ponytail-on-stimulants-active',
);

function readMode() {
  try {
    return normalizeMode(fs.readFileSync(statePath, 'utf8').trim()) || getDefaultMode();
  } catch (e) {
    return getDefaultMode();
  }
}

function writeMode(mode) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, mode);
}

export default async ({ client } = {}) => {
  const log = (level, message) => {
    try { client && client.app && client.app.log({ body: { service: 'ponytail-on-stimulants', level, message } }); } catch (e) {}
  };

  const ponytailSkillsDir = path.resolve(__dirname, '../../skills');

  return {
    // Register slash commands + skills directory.
    config: async (config) => {
      if (!config.command) config.command = {};
      const commandDir = path.join(__dirname, '..', 'command');
      try {
        for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith('.md'))) {
          const name = path.basename(file, '.md');
          const parsed = parseCommandFile(path.join(commandDir, file));
          if (parsed) config.command[name] = parsed;
        }
      } catch (e) {}

      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(ponytailSkillsDir)) {
        config.skills.paths.push(ponytailSkillsDir);
      }
    },

    // Append the ruleset to the system prompt every turn.
    'experimental.chat.system.transform': async (_input, output) => {
      const mode = readMode();
      if (mode === 'off') return;
      const instructions = getPonytailInstructions(mode);
      if (output.system.length > 0) {
        output.system[output.system.length - 1] += '\n\n' + instructions;
      } else {
        output.system.push(instructions);
      }
    },

    // Persist `/ponytail-on-stimulants <mode>` for the next turn.
    // Mode applies from the next message, not the current one — the
    // transform reads the state file the command writes.
    'command.execute.before': async (input) => {
      if (!input || input.command !== 'ponytail-on-stimulants') return;
      const args = String(input.arguments || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (args[0] === 'status') {
        log('info', `ponytail-on-stimulants current=${readMode()} default=${getDefaultMode()}`);
        return;
      }
      if (args[0] === 'default') {
        const mode = normalizeMode(args[1]);
        if (mode && writeDefaultMode(mode)) log('info', `ponytail-on-stimulants default ${mode}`);
        else log('warn', 'ponytail-on-stimulants invalid default mode');
        return;
      }
      const mode = args.length === 0 ? getDefaultMode() : normalizeMode(args[0]);
      if (!mode) {
        log('warn', 'ponytail-on-stimulants invalid mode');
        return;
      }
      writeMode(mode);
      log('info', 'ponytail-on-stimulants ' + mode);
    },
  };
};
