import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEFAULT_MODE,
  RUNTIME_MODES,
  getDefaultMode,
  getQuietStartup,
  getHideStatus,
  normalizeMode,
  isDeactivationCommand,
  writeDefaultMode,
} = require('../hooks/ponytail-on-stimulants-config.js');
const {
  getPonytailInstructions,
  filterSkillBodyForMode,
} = require('../hooks/ponytail-on-stimulants-instructions.js');
const {
  buildContinuationPrompt,
  claimContinuation,
  collectGitEvidence,
  compactEvidence,
  createTurnState,
  maxContinuations,
  recordToolCall,
  recordToolResult,
  shouldRunCompletionPass,
  summarizeTrackedEvidence,
} = require('../completion-gate/index.js');
const { createJevJudge } = require('../completion-gate/jev.js');

export { filterSkillBodyForMode };
export const readDefaultMode = getDefaultMode;
export const readQuietStartup = getQuietStartup;

const COMMAND = 'ponytail-on-stimulants';
const MODE_ENTRY = 'ponytail-on-stimulants-mode';
const MODE_LIST = RUNTIME_MODES.join('|');

export function resolveSessionMode(entries, fallbackMode = DEFAULT_MODE) {
  const fallback = normalizeMode(fallbackMode) || DEFAULT_MODE;
  if (!Array.isArray(entries)) return fallback;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== 'custom' || entry.customType !== MODE_ENTRY) continue;
    const mode = normalizeMode(entry.data && entry.data.mode);
    if (mode) return mode;
  }
  return fallback;
}

export function parsePonytailCommand(text, defaultMode = DEFAULT_MODE) {
  const fallback = normalizeMode(defaultMode) || DEFAULT_MODE;
  const normalizedText = String(text || '').trim().toLowerCase();
  if (!normalizedText) return { type: 'set-mode', mode: fallback === 'off' ? DEFAULT_MODE : fallback };

  const [primary, secondary] = normalizedText.split(/\s+/);
  if (primary === 'status') return { type: 'status' };
  if (primary === 'default') {
    const mode = normalizeMode(secondary);
    return mode ? { type: 'set-default', mode } : { type: 'invalid', reason: 'invalid-default-mode' };
  }
  const mode = normalizeMode(primary);
  return mode ? { type: 'set-mode', mode } : { type: 'invalid', reason: 'invalid-mode', mode: primary };
}

export { writeDefaultMode };

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part && part.type === 'text')
    .map((part) => part.text || '')
    .join('\n');
}

function compactJevEvidence(tracked, git) {
  return {
    git_available: git.available,
    git_error_count: git.errors.length,
    changed_file_count: git.changedFiles.length,
    diff_check_failed: git.diffCheckFailed,
    introduced_todo_count: git.introducedTodos.length,
    unresolved_tool_error_count: tracked.toolErrors.length,
    recent_tools: tracked.recentTools.slice(-10).map(({ tool, status }) => ({ tool, status })),
    repeated_action_count: tracked.repeatedActions.length,
    repeated_failure_count: tracked.repeatedFailures.length,
  };
}

export default function ponytailOnStimulantsExtension(pi, options = {}) {
  let currentMode = DEFAULT_MODE;
  let configuredDefaultMode = getDefaultMode();
  let hideStatus = getHideStatus();
  let isActive = false;
  let lastCtx = null;
  let turnState = createTurnState('');
  let finalAssistantMessage = '';
  let queuedPass = null;
  const jevJudge = options.jevJudge === undefined ? createJevJudge() : options.jevJudge;

  function statusSurface(ctx) {
    if (ctx) lastCtx = ctx;
    const context = ctx || lastCtx;
    if (!context) return null;
    const ui = context.ui;
    if (!ui || typeof ui.setStatus !== 'function') return null;
    const theme = ui.theme;
    if (!theme || typeof theme.fg !== 'function') return null;
    return { theme, ui };
  }

  function syncStatus(ctx) {
    if (hideStatus) return;
    const surface = statusSurface(ctx);
    if (!surface) return;
    const { theme, ui } = surface;
    if (currentMode === 'off') {
      ui.setStatus(COMMAND, '');
      return;
    }
    const icons = { focused: '🎯', 'full-send': '⚡', feral: '🔥' };
    const indicator = isActive ? theme.fg('accent', '●') : theme.fg('dim', '○');
    const icon = icons[currentMode] || '';
    const pass = queuedPass
      ? theme.fg('muted', ` · pass ${queuedPass.pass}/${queuedPass.maximum}`)
      : '';
    ui.setStatus(
      COMMAND,
      `${indicator} 🐴 ${theme.fg('muted', 'stimulants: ')}${theme.fg('text', `${icon} ${currentMode.toUpperCase()}`)}${pass}`,
    );
  }

  function setMode(mode, ctx) {
    const normalized = normalizeMode(mode);
    if (!normalized) return;
    currentMode = normalized;
    pi.appendEntry(MODE_ENTRY, { mode: normalized });
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Ponytail on Stimulants mode set to ${normalized}.`, 'info');
  }

  function sendSkillCommand(skillName, args, ctx) {
    const tail = String(args || '').trim();
    const message = tail ? `${skillName} ${tail}` : skillName;
    if (ctx?.isIdle?.() === false) {
      pi.sendUserMessage(message, { deliverAs: 'followUp', expandPromptTemplates: true });
      ctx?.ui?.notify?.(`${skillName} queued as follow-up.`, 'info');
      return;
    }
    pi.sendUserMessage(message, { expandPromptTemplates: true });
  }

  function notify(ctx, message, level = 'info') {
    if (ctx && ctx.ui && typeof ctx.ui.notify === 'function') ctx.ui.notify(message, level);
  }

  function persistDefault(mode, ctx) {
    try {
      const written = writeDefaultMode(mode);
      if (!written) return;
      configuredDefaultMode = getDefaultMode();
      const message = configuredDefaultMode === written
        ? `Default mode set to ${written}.`
        : `Saved ${written}, but an environment override keeps ${configuredDefaultMode}.`;
      notify(ctx, message);
    } catch (error) {
      notify(ctx, `Failed to save default mode: ${error.message}`, 'error');
    }
  }

  function handleCommand(args, ctx) {
    const parsed = parsePonytailCommand(args, configuredDefaultMode);
    if (parsed.type === 'status') {
      notify(ctx, `Ponytail on Stimulants: current ${currentMode} • default ${configuredDefaultMode}`);
      return;
    }
    if (parsed.type === 'set-default') return persistDefault(parsed.mode, ctx);
    if (parsed.type === 'set-mode') return setMode(parsed.mode, ctx);
    notify(ctx, 'Unknown or unsupported Ponytail on Stimulants mode.', 'warning');
  }

  pi.registerCommand(COMMAND, {
    description: `Set mode: ${MODE_LIST}. Commands: status, default <mode>`,
    handler: handleCommand,
  });

  for (const suffix of ['review', 'audit', 'gain', 'debt', 'help']) {
    const name = `${COMMAND}-${suffix}`;
    pi.registerCommand(name, {
      description: `Run /skill:${name}`,
      handler: (args, ctx) => sendSkillCommand(`/skill:${name}`, args, ctx),
    });
  }

  pi.on('input', async (event, ctx) => {
    const source = event && event.source;
    if (source === 'extension') return;
    const text = event && event.text;
    turnState = createTurnState(text || '');
    finalAssistantMessage = '';
    queuedPass = null;
    syncStatus(ctx);
    if (currentMode === 'off') return;
    if (isDeactivationCommand(text)) setMode('off', ctx);
  });

  function sessionEntries(ctx) {
    if (!ctx || !ctx.sessionManager) return [];
    const manager = ctx.sessionManager;
    if (typeof manager.getBranch === 'function') return manager.getBranch();
    if (typeof manager.getEntries === 'function') return manager.getEntries();
    return [];
  }

  pi.on('session_start', async (_event, ctx) => {
    const entries = sessionEntries(ctx);
    configuredDefaultMode = getDefaultMode();
    hideStatus = getHideStatus();
    currentMode = resolveSessionMode(entries, configuredDefaultMode);
    turnState = createTurnState('');
    finalAssistantMessage = '';
    queuedPass = null;
    syncStatus(ctx);
    if (!getQuietStartup()) notify(ctx, `Ponytail on Stimulants loaded: ${currentMode}`);
  });

  pi.on('agent_start', async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on('agent_end', async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
    try {
      await handleSettlement(ctx);
    } catch (_) {
      // Completion gating is advisory and fail-open; it must never trap a session.
    }
  });

  pi.on('message_end', async (event) => {
    if (event?.message?.role === 'assistant') finalAssistantMessage = messageText(event.message);
  });

  pi.on('tool_execution_start', async (event) => {
    recordToolCall(
      turnState,
      event?.toolName || 'unknown',
      event?.args || {},
      event?.toolCallId,
    );
  });

  pi.on('tool_execution_end', async (event) => {
    recordToolResult(
      turnState,
      event?.toolName || 'unknown',
      {},
      Boolean(event?.isError),
      event?.toolCallId,
    );
  });

  function settlementIsStale(state, mode) {
    return turnState !== state || currentMode !== mode;
  }

  function jevState(state, message, tracked, git) {
    return {
      requestMetadata: {
        hasTask: Boolean(state.prompt.trim()),
        taskLength: state.prompt.length,
      },
      responseMetadata: {
        claimedComplete: /\b(done|complete|completed|fixed|implemented|verified)\b/i.test(message),
        reportedBlocker: /\b(blocked|blocker|unable|could not)\b/i.test(message),
        responseLength: message.length,
      },
      changedFiles: git.changedFiles,
      verification: tracked.recentTools
        .filter((item) => item.tool === 'bash' && item.status === 'passed')
        .map((item) => `bash:${item.fingerprint}`),
      deterministicEvidence: compactJevEvidence(tracked, git),
      unresolvedErrors: tracked.toolErrors.map((item) => `${item.tool}:${item.fingerprint}`),
    };
  }

  async function judgeSettlement(state, mode, message, tracked, git) {
    if (!jevJudge || mode !== 'feral' || state.continuations < 1) return null;
    return jevJudge(jevState(state, message, tracked, git));
  }

  function recordedJev(jev) {
    if (!jev) return null;
    return {
      verdict: jev.verdict,
      model: jev.model,
      reason: jev.reason,
      latencyMs: jev.latencyMs,
      usage: jev.usage,
      answers: jev.answers,
    };
  }

  async function handleSettlement(ctx) {
    const state = turnState;
    const mode = currentMode;
    const message = finalAssistantMessage;
    const tracked = summarizeTrackedEvidence(state);
    if (!shouldRunCompletionPass(mode, state, { tracked })) return;
    const git = await collectGitEvidence(
      (command, args, execOptions) => pi.exec(command, args, execOptions),
      ctx && ctx.cwd,
    );
    if (settlementIsStale(state, mode)) return;
    const evidence = { tracked, git };
    const jev = await judgeSettlement(state, mode, message, tracked, git);
    if (settlementIsStale(state, mode)) return;
    const maximum = maxContinuations(mode);
    const prompt = buildContinuationPrompt({
      mode,
      pass: state.continuations + 1,
      maximum,
      evidence,
      jev,
    });
    if (!claimContinuation(state, prompt, maximum)) return;
    pi.appendEntry('ponytail-on-stimulants-completion-pass', {
      mode,
      pass: state.continuations,
      evidence: compactEvidence(evidence),
      jev: recordedJev(jev),
    });
    // agent_end handlers run before Pi decides whether queued follow-ups remain.
    // Queueing here keeps RPC's public agent_settled event truthful: it fires only
    // after every bounded completion pass, never between the original turn and a pass.
    pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
    queuedPass = { pass: state.continuations, maximum };
    syncStatus(ctx);
    notify(ctx, `Completion pass ${state.continuations}/${maximum} queued.`);
  }

  pi.on('before_agent_start', async (event) => {
    if (!currentMode || currentMode === 'off') return;
    const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : '';
    return { systemPrompt: `${base}${getPonytailInstructions(currentMode)}` };
  });
}
