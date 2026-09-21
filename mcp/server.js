#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'skills', 'ponytail-on-stimulants', 'SKILL.md');
const MODES = Object.freeze(['focused', 'full-send', 'feral']);
const DEFAULT_MODE = 'full-send';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'ponytail-on-stimulants';
const TOOL_NAME = 'ponytail_on_stimulants_instructions';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8')).version;

function canonicalMode(value) {
  return typeof value === 'string' && MODES.includes(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;
}

function configPath() {
  if (process.env.PLUGIN_DATA) {
    return path.join(process.env.PLUGIN_DATA, 'config.json');
  }
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, SERVER_NAME, 'config.json');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, SERVER_NAME, 'config.json');
  }
  return path.join(os.homedir(), '.config', SERVER_NAME, 'config.json');
}

function configuredMode() {
  const fromEnvironment = canonicalMode(process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE);
  if (fromEnvironment) return fromEnvironment;
  try {
    const config = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return canonicalMode(config && config.defaultMode) || DEFAULT_MODE;
  } catch (_) {
    return DEFAULT_MODE;
  }
}

function resolveMode(value) {
  return value === undefined ? configuredMode() : canonicalMode(value);
}

function stripFrontmatter(text) {
  return String(text || '').replace(/^---[\s\S]*?---\s*/, '');
}

function filterSkillBody(body, mode) {
  return stripFrontmatter(body)
    .split(/\r?\n/)
    .filter((line) => {
      const table = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (table && MODES.includes(table[1].trim())) return table[1].trim() === mode;
      const example = line.match(/^-\s*([^:]+):\s*"/);
      if (example && MODES.includes(example[1].trim())) return example[1].trim() === mode;
      return true;
    })
    .join('\n');
}

function buildInstructions(mode) {
  try {
    const body = fs.readFileSync(SKILL_PATH, 'utf8');
    return `PONYTAIL ON STIMULANTS ACTIVE — mode: ${mode}\n\n${filterSkillBody(body, mode)}`;
  } catch (_) {
    return `PONYTAIL ON STIMULANTS ACTIVE — mode: ${mode}\n\n` +
      'Minimal architecture. Maximal execution. Finish the requested outcome, verify it proportionately, and keep scope bounded.';
  }
}

const modeSchema = {
  type: 'string',
  enum: MODES,
  description: 'Execution mode. Omit to use the configured default.',
};

const prompt = {
  name: SERVER_NAME,
  description: 'Minimal architecture, maximal execution instructions.',
  arguments: [{ name: 'mode', description: modeSchema.description, required: false }],
};

const tool = {
  name: TOOL_NAME,
  description: 'Return the completion ruleset for focused, full-send, or feral mode.',
  inputSchema: {
    type: 'object',
    properties: { mode: modeSchema },
    additionalProperties: false,
  },
};

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function requestedMode(params, field) {
  const values = params && params[field];
  if (values === undefined) return configuredMode();
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  if (Object.keys(values).some((key) => key !== 'mode')) return null;
  return resolveMode(values.mode);
}

function invalidMode(id) {
  return error(id, -32602, `mode must be one of: ${MODES.join(', ')}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validRequestId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id));
}

function validInitializeParams(params) {
  return isObject(params)
    && typeof params.protocolVersion === 'string'
    && isObject(params.capabilities)
    && isObject(params.clientInfo)
    && typeof params.clientInfo.name === 'string'
    && typeof params.clientInfo.version === 'string';
}

function initialize(id, params) {
  if (!validInitializeParams(params)) return error(id, -32602, 'Invalid initialize parameters');
  return result(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { prompts: { listChanged: false }, tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: VERSION },
  });
}

function getPrompt(id, params) {
  if (!params || params.name !== SERVER_NAME) return error(id, -32602, 'Unknown prompt');
  const mode = requestedMode(params, 'arguments');
  if (!mode) return invalidMode(id);
  return result(id, {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: buildInstructions(mode) } }],
  });
}

function callTool(id, params) {
  if (!params || params.name !== TOOL_NAME) return error(id, -32602, 'Unknown tool');
  const mode = requestedMode(params, 'arguments');
  if (!mode) return invalidMode(id);
  const instructions = buildInstructions(mode);
  return result(id, {
    content: [{ type: 'text', text: instructions }],
  });
}

const handlers = new Map([
  ['initialize', initialize],
  ['ping', (id) => result(id, {})],
  ['prompts/list', (id) => result(id, { prompts: [prompt] })],
  ['prompts/get', getPrompt],
  ['tools/list', (id) => result(id, { tools: [tool] })],
  ['tools/call', callTool],
]);

let lifecycle = 'uninitialized';

function invalidEnvelope(message) {
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return true;
  return Object.hasOwn(message, 'id') && !validRequestId(message.id);
}

function dispatchNotification(method) {
  if (method === 'notifications/initialized' && lifecycle === 'initializing') lifecycle = 'ready';
}

function dispatch(message) {
  if (invalidEnvelope(message)) return error(null, -32600, 'Invalid Request');
  const { method, params } = message;
  const isNotification = !Object.hasOwn(message, 'id');
  if (isNotification) {
    dispatchNotification(method);
    return undefined;
  }
  const { id } = message;
  if (method.startsWith('notifications/')) return error(id, -32600, 'Invalid Request');
  if (method === 'initialize') {
    if (lifecycle !== 'uninitialized') return error(id, -32600, 'Already initialized');
    const response = initialize(id, params);
    if (response.result) lifecycle = 'initializing';
    return response;
  }
  if (lifecycle !== 'ready') return error(id, -32002, 'Server not initialized');
  const handler = handlers.get(method);
  return handler ? handler(id, params) : error(id, -32601, 'Method not found');
}

function send(message) {
  if (message !== undefined) process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
lines.on('line', (line) => {
  if (!line.trim()) return;
  try {
    send(dispatch(JSON.parse(line)));
  } catch (_) {
    send(error(null, -32700, 'Parse error'));
  }
});
