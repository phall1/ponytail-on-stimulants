'use strict';

const {
  createSpawnExec,
  createTurnState,
  isContinuationPrompt,
  recordToolCall,
  recordToolResult,
  runCompletionDecision,
} = require('../../completion-gate');

function eventSessionId(event) {
  const props = (event && event.properties) || {};
  const info = props.info || {};
  return props.sessionID || props.sessionId || info.id || info.sessionID || info.sessionId || null;
}

function messageRole(event) {
  const props = (event && event.properties) || {};
  const info = props.info || props.message || {};
  return info.role || props.role || null;
}

function messageText(event) {
  const props = (event && event.properties) || {};
  const info = props.info || props.message || props.part || {};
  if (typeof info.content === 'string') return info.content;
  if (typeof props.text === 'string') return props.text;
  if (typeof info.text === 'string') return info.text;
  return '';
}

async function promptSession(client, sessionID, text) {
  if (!client || !client.session || !sessionID || !text) return false;
  const session = client.session;
  const parts = [{ type: 'text', text }];
  if (typeof session.prompt === 'function') {
    try {
      await session.prompt({ path: { id: sessionID }, body: { parts } });
      return true;
    } catch (_) {}
  }
  if (typeof session.chat === 'function') {
    try {
      await session.chat({ sessionID, parts });
      return true;
    } catch (_) {}
  }
  return false;
}

function createCompletionHost({ directory, exec } = {}) {
  const sessions = new Map();
  const spawnExec = exec || createSpawnExec();
  let lastSessionId = 'default';

  function session(id) {
    const key = id || lastSessionId || 'default';
    lastSessionId = key;
    if (!sessions.has(key)) sessions.set(key, createTurnState(''));
    return { key, state: sessions.get(key) };
  }

  function reset(id, prompt) {
    if (isContinuationPrompt(prompt)) return session(id);
    const key = id || lastSessionId || 'default';
    lastSessionId = key;
    const state = createTurnState(prompt || '');
    sessions.set(key, state);
    return { key, state };
  }

  function recordTool(id, toolName, args, callId) {
    const current = session(id);
    recordToolCall(current.state, toolName, args, callId);
    return current;
  }

  function recordResult(id, toolName, args, isError, callId) {
    const current = session(id);
    recordToolResult(current.state, toolName, args || {}, Boolean(isError), callId);
    return current;
  }

  async function decide(mode, id) {
    const current = session(id);
    return runCompletionDecision({
      mode,
      state: current.state,
      exec: spawnExec,
      cwd: directory,
    });
  }

  return { decide, recordResult, recordTool, reset, session };
}

module.exports = {
  createCompletionHost,
  eventSessionId,
  messageRole,
  messageText,
  promptSession,
};
