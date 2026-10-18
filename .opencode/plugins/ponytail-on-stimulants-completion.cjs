'use strict';

const {
  createSpawnExec,
  createTurnState,
  isContinuationPrompt,
  recordToolCall,
  recordToolResult,
  runCompletionDecision,
} = require('../../completion-gate');
const { recordRecap, rememberAnswer } = require('../../completion-gate/recap');

function eventSessionId(event) {
  const props = event?.data || event?.properties || {};
  const info = props.info || {};
  // message.updated info.id is the MESSAGE id, not the session id.
  return props.sessionID || props.sessionId || info.sessionID || info.sessionId || null;
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

function createCompletionHost({ directory, exec, harness = 'opencode', isChild = async () => false } = {}) {
  const sessions = new Map();
  const replies = new Map();
  const pending = new Set();
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
    replies.delete(key);
    return { key, state };
  }

  function recordReply(id, text) {
    if (id && text) replies.set(id, text);
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
    if (!id || !sessions.has(id) || pending.has(id)) return null;
    const current = session(id);
    pending.add(id);
    try {
      const decision = await runCompletionDecision({
        mode,
        state: current.state,
        exec: spawnExec,
        cwd: directory,
      });
      return sessions.get(id) === current.state ? decision : null;
    } finally {
      pending.delete(id);
    }
  }

  // Decide a completion pass; when the turn is settled instead, recap it.
  async function settle(mode, id) {
    if (pending.has(id)) return null;
    const state = sessions.get(id);
    const decision = await decide(mode, id);
    if (decision) rememberAnswer(state, replies.get(id));
    if (decision || !state || sessions.get(id) !== state) return decision;
    // Subagent sessions are summarized by their parent's recap.
    if (await isChild(id).catch(() => false)) return null;
    await recordRecap({ harness, cwd: directory, session: id, state, reply: replies.get(id), exec: spawnExec });
    return null;
  }

  function remove(id) {
    sessions.delete(id);
    replies.delete(id);
  }

  return { decide, recordReply, recordResult, recordTool, remove, reset, session, settle };
}

module.exports = {
  createCompletionHost,
  eventSessionId,
  messageRole,
  messageText,
  promptSession,
};
