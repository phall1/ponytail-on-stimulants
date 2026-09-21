// Ponytail on Stimulants — OpenCode plugin.
//
// Injects the completion ruleset, persists /ponytail-on-stimulants switches,
// registers slash commands, tracks tool evidence, and runs a bounded
// completion continuation when the host allows it.
//
// Honest host contract:
// - `session.stopping` (when present) can keep the loop alive in-process.
// - otherwise `session.idle` plus `client.session.prompt` is a best-effort
//   post-stop continuation. OpenCode does not expose Pi's agent_end follow-up.
//
// OpenCode loads this as a server plugin — add it to your opencode.json:
//   { "plugin": ["ponytail-on-stimulants"] }

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared helpers stay CommonJS; OpenCode treats every ESM export as a plugin.
const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require('../../hooks/ponytail-on-stimulants-instructions');
const {
  getDefaultMode,
  normalizeMode,
  writeDefaultMode,
} = require('../../hooks/ponytail-on-stimulants-config');
const { parseCommandFile } = require('./ponytail-on-stimulants-frontmatter.cjs');
const {
  createCompletionHost,
  eventSessionId,
  messageRole,
  messageText,
  promptSession,
} = require('./ponytail-on-stimulants-completion.cjs');

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

export default async ({ client, directory } = {}) => {
  const log = (level, message) => {
    try { client && client.app && client.app.log({ body: { service: 'ponytail-on-stimulants', level, message } }); } catch (e) {}
  };

  const ponytailSkillsDir = path.resolve(__dirname, '../../skills');
  const host = createCompletionHost({ directory });
  const stopHookContinued = new Set();

  async function maybeContinue(sessionID, output) {
    const mode = readMode();
    if (!mode || mode === 'off' || mode === 'focused') return false;
    const key = sessionID || 'default';
    if (!output && stopHookContinued.has(key)) {
      stopHookContinued.delete(key);
      return false;
    }
    const decision = await host.decide(mode, sessionID);
    if (!decision) return false;
    if (output && typeof output === 'object') {
      output.stop = false;
      output.message = decision.prompt;
      stopHookContinued.add(key);
      return true;
    }
    const sent = await promptSession(client, sessionID, decision.prompt);
    if (!sent) log('info', 'completion gate decided to continue but OpenCode session.prompt is unavailable');
    return sent;
  }

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

    'tool.execute.before': async (input, output) => {
      try {
        host.recordTool(
          input && (input.sessionID || input.sessionId),
          input && input.tool,
          (output && output.args) || (input && input.args) || {},
          input && (input.callID || input.toolCallId),
        );
      } catch (e) {}
    },

    'tool.execute.after': async (input, output) => {
      try {
        const isError = Boolean(output && (output.error || output.isError || output.status === 'error'));
        host.recordResult(
          input && (input.sessionID || input.sessionId),
          input && input.tool,
          (output && output.args) || (input && input.args) || {},
          isError,
          input && (input.callID || input.toolCallId),
        );
      } catch (e) {}
    },

    // In-loop continuation when the host actually exposes this hook.
    'session.stopping': async (input, output) => {
      try {
        const sessionID = input && (input.sessionID || input.sessionId);
        if (output && typeof output === 'object') {
          await maybeContinue(sessionID, output);
          return;
        }
        await maybeContinue(sessionID);
      } catch (e) {}
    },

    event: async ({ event }) => {
      try {
        if (!event || !event.type) return;
        if (event.type === 'message.updated' && messageRole(event) === 'user') {
          const id = eventSessionId(event);
          host.reset(id, messageText(event));
          stopHookContinued.delete(id || 'default');
          return;
        }
        if (event.type === 'session.idle') {
          await maybeContinue(eventSessionId(event));
        }
      } catch (e) {}
    },
  };
};
