#!/usr/bin/env node
// Ponytail on Stimulants — install or remove the fork's Codex hooks as
// user-level hooks in $CODEX_HOME/hooks.json (default ~/.codex/hooks.json).
// Use this when Codex does not run plugin-bundled hooks (feature
// `plugin_hooks` off); never combine both or every hook runs twice. Only
// matcher groups whose commands all run ponytail-on-stimulants-*.js are
// owned; every other hook stays as it was. Codex still requires `/hooks`
// review before user hooks run.
//
//   node scripts/codex-hooks.js install
//   node scripts/codex-hooks.js uninstall

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isShellSafe } = require('../hooks/ponytail-on-stimulants-config');
const { isPonytailHook } = require('./cursor-hooks');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'hooks', 'codex-hooks.json');
const PLUGIN_COMMAND = /hooks\/(ponytail-on-stimulants-[\w-]+\.js)'\)\)"(.*)$/;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function hooksPath() {
  return path.join(codexHome(), 'hooks.json');
}

function isPonytailGroup(group) {
  return Boolean(group && Array.isArray(group.hooks) && group.hooks.length && group.hooks.every(isPonytailHook));
}

// Missing file → empty config. Malformed JSON throws a SyntaxError so the
// caller can refuse to touch the file rather than overwrite it.
function readConfig(file) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const valid = config && typeof config === 'object' && !Array.isArray(config) &&
    (config.hooks === undefined || (config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks))) &&
    Object.values(config.hooks || {}).every(Array.isArray);
  if (!valid) throw new SyntaxError('Expected an object whose hooks map events to arrays');
  if (config.hooks === undefined) config.hooks = {};
  return config;
}

// Plugin commands resolve the root from CLAUDE_PLUGIN_ROOT and detect Codex
// from PLUGIN_DATA, neither of which Codex sets for user hooks. Bake both in.
function ponytailGroups() {
  const root = ROOT.replace(/\\/g, '/');
  const data = path.join(codexHome(), 'ponytail-on-stimulants').replace(/\\/g, '/');
  if (!isShellSafe(root) || !isShellSafe(data)) {
    throw new Error('Ponytail on Stimulants or CODEX_HOME is at a path with shell metacharacters; copy hooks/codex-hooks.json by hand');
  }
  const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  const hooks = {};
  for (const [event, groups] of Object.entries(template.hooks)) {
    hooks[event] = groups.map((group) => ({
      ...group,
      hooks: group.hooks.map((hook) => {
        const [, script, args] = hook.command.match(PLUGIN_COMMAND);
        return { ...hook, command: `PLUGIN_DATA='${data}' node '${root}/hooks/${script}'${args}` };
      }),
    }));
  }
  return hooks;
}

function stripPonytail(config) {
  for (const [event, groups] of Object.entries(config.hooks)) {
    const kept = groups.filter((group) => !isPonytailGroup(group));
    if (kept.length) config.hooks[event] = kept;
    else delete config.hooks[event];
  }
}

function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function install() {
  const file = hooksPath();
  const config = readConfig(file);
  // Re-running replaces stale fork entries instead of duplicating them.
  stripPonytail(config);
  for (const [event, groups] of Object.entries(ponytailGroups())) {
    config.hooks[event] = [...(config.hooks[event] || []), ...groups];
  }
  writeConfig(file, config);
  return file;
}

// Returns the file it changed, or null when there was no fork-owned entry.
function uninstall() {
  const file = hooksPath();
  if (!fs.existsSync(file)) return null;
  const config = readConfig(file);
  const before = JSON.stringify(config);
  stripPonytail(config);
  if (JSON.stringify(config) === before) return null;
  if (Object.keys(config.hooks).length === 0 && Object.keys(config).length === 1) fs.unlinkSync(file);
  else writeConfig(file, config);
  return file;
}

if (require.main === module) {
  const action = process.argv[2];
  try {
    if (action === 'install') {
      console.log('Installed Ponytail on Stimulants hooks in ' + install());
      console.log('Open /hooks in Codex to review and trust them.');
    } else if (action === 'uninstall') {
      const file = uninstall();
      console.log(file ? 'Removed Ponytail on Stimulants hooks from ' + file : 'No Ponytail on Stimulants hooks in ' + hooksPath());
    } else {
      console.error('usage: node scripts/codex-hooks.js install|uninstall');
      process.exit(1);
    }
  } catch (e) {
    console.error(e instanceof SyntaxError
      ? hooksPath() + ' is not valid JSON; nothing was changed, fix it by hand (' + e.message + ')'
      : e.message);
    process.exit(1);
  }
}

module.exports = { hooksPath, install, ponytailGroups, uninstall };
