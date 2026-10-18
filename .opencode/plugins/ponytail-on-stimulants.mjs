// One default definition: OpenCode 2 uses setup; OpenCode 1 uses server.
// Completion on OpenCode is a bounded, best-effort post-run prompt, not an
// invented in-loop stopping hook. Shared helpers stay outside this export.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require('../../hooks/ponytail-on-stimulants-instructions');
const { DEFAULT_MODE, getDefaultMode, normalizeMode, writeDefaultMode } = require('../../hooks/ponytail-on-stimulants-config');
const { parseCommandFile, parseSkillFile } = require('./ponytail-on-stimulants-frontmatter.cjs');
const { createCompletionHost, eventSessionId, messageRole, messageText, promptSession } = require('./ponytail-on-stimulants-completion.cjs');

const COMMAND = 'ponytail-on-stimulants';
const statePath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', '.ponytail-on-stimulants-active');
const skillsDir = path.resolve(__dirname, '../../skills');

function readMode() {
  try { return normalizeMode(fs.readFileSync(statePath, 'utf8').trim()) || getDefaultMode(); }
  catch (_) { return getDefaultMode(); }
}

function persistMode(args, log) {
  const [first, second] = String(args || '').trim().toLowerCase().split(/\s+/);
  if (first === 'status' || (!first && readMode() !== 'off')) {
    log('info', `${COMMAND} current=${readMode()} default=${getDefaultMode()}`);
    return;
  }
  if (first === 'default') {
    const mode = writeDefaultMode(second);
    log(mode ? 'info' : 'warn', `${COMMAND} default ${mode || 'invalid'}`);
    return;
  }
  const mode = first ? normalizeMode(first) : (getDefaultMode() === 'off' ? DEFAULT_MODE : getDefaultMode());
  if (!mode) return log('warn', `${COMMAND} invalid mode`);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, mode);
  log('info', `${COMMAND} ${mode}`);
}

function readCommands() {
  const dir = path.join(__dirname, '..', 'command');
  return fs.readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => {
    const parsed = parseCommandFile(path.join(dir, file));
    return parsed && { name: path.basename(file, '.md'), ...parsed };
  }).filter(Boolean);
}

function readSkills() {
  return fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    const parsed = parseSkillFile(file);
    return parsed && { id: entry.name, name: parsed.name || entry.name, description: parsed.description, path: file, content: parsed.body };
  }).filter(Boolean);
}

function withArguments(template, text = '') {
  if (template.includes('$ARGUMENTS')) return template.replaceAll('$ARGUMENTS', () => text);
  return text.trim() ? `${template}\n\n${text.trim()}` : template;
}

function withoutMentions(items) {
  return items?.map(({ mention, ...item }) => item);
}

async function continueSession(host, send, id, signal) {
  try {
    const decision = await host.settle(readMode(), id);
    if (decision && !signal.aborted) await send(id, decision.prompt);
  } catch (_) { /* A rejected decision or delivery must not disable later sessions. */ }
}

async function consumeEvents(events, host, send, directory, signal) {
  try {
    for await (const event of events) {
      if (signal.aborted) return;
      if (event.location?.directory && event.location.directory !== directory) continue;
      const id = eventSessionId(event);
      if (['session.deleted', 'session.execution.failed', 'session.execution.interrupted'].includes(event.type)) host.remove(id);
      if (event.type === 'session.text.ended') host.recordReply(id, event.data?.text);
      if (event.type !== 'session.execution.succeeded') continue;
      await continueSession(host, send, id, signal);
    }
  } catch (_) { /* Advisory gate: transport/shutdown failures must not trap a session. */ }
}

export default {
  id: COMMAND,

  async setup(ctx) {
    const directory = ctx.location.directory;
    const host = createCompletionHost({ directory });
    const log = () => {}; // Never write plugin status to OpenCode's protocol stdout.
    const commands = readCommands();
    const skills = readSkills();
    await ctx.skill.transform((editor) => skills.forEach((skill) => editor.add(skill)));
    await ctx.command.transform((editor) => {
      for (const command of commands) {
        editor.add({
          name: command.name,
          description: command.description,
          execute: async ({ sessionID, prompt, delivery }) => {
            if (command.name === COMMAND) persistMode(prompt.text, log);
            await ctx.session.prompt({
              ...prompt, sessionID, delivery,
              text: withArguments(command.template, prompt.text),
              files: withoutMentions(prompt.files),
              agents: withoutMentions(prompt.agents),
              skills: withoutMentions(prompt.skills),
            });
          },
        });
      }
    });
    const addRuleset = (event) => {
      const mode = readMode();
      if (mode !== 'off') event.system.push({ type: 'text', text: getPonytailInstructions(mode) });
    };
    await ctx.session.hook('context', addRuleset);
    await ctx.session.hook('compaction', addRuleset);
    await ctx.session.hook('prompt', (event) => host.reset(event.sessionID, event.prompt.text));
    await ctx.tool.hook('execute.before', (event) => host.recordTool(event.sessionID, event.tool, event.input, event.id));
    await ctx.tool.hook('execute.after', (event) => host.recordResult(event.sessionID, event.tool, event.input, event.status === 'error', event.id));

    const controller = new AbortController();
    const events = ctx.event.subscribe({ signal: controller.signal });
    const running = consumeEvents(events, host, (sessionID, text) => ctx.session.prompt({ sessionID, text, delivery: 'queue' }), directory, controller.signal);
    return async () => { controller.abort(); await running; };
  },

  async server({ client, directory } = {}) {
    const host = createCompletionHost({ directory });
    const assistantMessages = new Set();
    const log = (level, message) => {
      try { client?.app?.log({ body: { service: COMMAND, level, message } }); } catch (_) {}
    };
    return {
      config: async (config) => {
        config.command ||= {};
        for (const { name, ...command } of readCommands()) config.command[name] = command;
        config.skills ||= {};
        config.skills.paths ||= [];
        if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);
      },
      'experimental.chat.system.transform': async (_input, output) => {
        const mode = readMode();
        if (mode === 'off') return;
        const instructions = getPonytailInstructions(mode);
        if (output.system.length) output.system[output.system.length - 1] += '\n\n' + instructions;
        else output.system.push(instructions);
      },
      'command.execute.before': async (input) => {
        if (input?.command === COMMAND) persistMode(input.arguments, log);
      },
      // V1 message.updated carries metadata, not prompt text. Reset from the
      // actual chat input so our own continuation cannot reset its hard cap.
      'chat.message': async (input, output) => {
        const text = output.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        host.reset(input.sessionID, text);
      },
      'tool.execute.before': async (input, output) => {
        host.recordTool(input.sessionID, input.tool, output.args, input.callID);
      },
      'tool.execute.after': async (input, output) => {
        host.recordResult(input.sessionID, input.tool, input.args, Boolean(output.error || output.isError), input.callID);
      },
      event: async ({ event }) => {
        try {
          const id = eventSessionId(event);
          if (event.type === 'session.deleted') host.remove(id);
          // Compatibility for older hosts that include text on this event.
          if (event.type === 'message.updated' && messageRole(event) === 'user' && messageText(event)) host.reset(id, messageText(event));
          if (event.type === 'message.updated' && messageRole(event) === 'assistant') assistantMessages.add(event.properties.info.id);
          const part = event.type === 'message.part.updated' && event.properties?.part;
          if (part?.type === 'text' && assistantMessages.has(part.messageID)) host.recordReply(part.sessionID, part.text);
          if (event.type !== 'session.idle') return;
          const decision = await host.settle(readMode(), id);
          if (decision) await promptSession(client, id, decision.prompt);
        } catch (_) {}
      },
    };
  },
};
