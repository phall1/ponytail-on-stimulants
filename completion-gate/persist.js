'use strict';

const fs = require('fs');
const path = require('path');
const { createTurnState, restoreTurnState, serializeTurnState } = require('./index');

const TURN_PREFIX = '.ponytail-on-stimulants-turn';

function safeSessionId(sessionId) {
  const raw = String(sessionId || 'default').trim() || 'default';
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'default';
}

function turnStatePath(stateDir, sessionId) {
  return path.join(stateDir, `${TURN_PREFIX}-${safeSessionId(sessionId)}.json`);
}

function loadTurnState(file) {
  try {
    return restoreTurnState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return createTurnState('');
  }
}

function saveTurnState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(serializeTurnState(state)));
}

function resetTurnState(file, prompt) {
  const state = createTurnState(prompt);
  saveTurnState(file, state);
  return state;
}

function listTurnStateFiles(stateDir) {
  try {
    return fs.readdirSync(stateDir)
      .filter((name) => name.startsWith(TURN_PREFIX) && name.endsWith('.json'))
      .map((name) => path.join(stateDir, name));
  } catch (_) {
    return [];
  }
}

module.exports = {
  TURN_PREFIX,
  listTurnStateFiles,
  loadTurnState,
  resetTurnState,
  saveTurnState,
  safeSessionId,
  turnStatePath,
};
