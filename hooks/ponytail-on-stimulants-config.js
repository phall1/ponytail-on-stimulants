#!/usr/bin/env node
// Ponytail on Stimulants — shared configuration resolver.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MODE = 'full-send';
const RUNTIME_MODES = ['off', 'focused', 'full-send', 'feral'];

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return RUNTIME_MODES.includes(normalized) ? normalized : null;
}

function isDeactivationCommand(text) {
  const command = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return command === 'stop ponytail on stimulants' ||
    command === 'stop ponytail-on-stimulants';
}

// Only embed ordinary paths in shell snippets. A hostile clone path falls back
// to manual setup rather than requiring separate escaping for every shell.
function isShellSafe(value) {
  return typeof value === 'string' && /^[A-Za-z0-9 _.\-:/\\~]+$/.test(value);
}

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ponytail-on-stimulants');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'ponytail-on-stimulants',
    );
  }
  return path.join(os.homedir(), '.config', 'ponytail-on-stimulants');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, ''));
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  } catch (_) {
    return {};
  }
}

function getDefaultMode() {
  const envMode = normalizeMode(process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE);
  if (envMode) return envMode;
  return normalizeMode(readConfig().defaultMode) || DEFAULT_MODE;
}

function truthyEnv(name) {
  const value = process.env[name];
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no';
}

function getQuietStartup() {
  return truthyEnv('PONYTAIL_ON_STIMULANTS_QUIET_STARTUP') ?? readConfig().quietStartup === true;
}

function getHideStatus() {
  return truthyEnv('PONYTAIL_ON_STIMULANTS_HIDE_STATUS') ?? readConfig().hideStatus === true;
}

function writeDefaultMode(mode) {
  const normalized = normalizeMode(mode);
  if (!normalized) return null;

  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const config = readConfig();
  config.defaultMode = normalized;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return normalized;
}

module.exports = {
  DEFAULT_MODE,
  RUNTIME_MODES,
  getDefaultMode,
  getConfigDir,
  getConfigPath,
  getClaudeDir,
  getHideStatus,
  getQuietStartup,
  isShellSafe,
  normalizeMode,
  isDeactivationCommand,
  writeDefaultMode,
};
