#!/usr/bin/env node
// Hermes support is a real plugin, not just copied rules: the repo root must be
// installable with `hermes plugins install owner/repo`, register bundled skills,
// inject active mode context, and expose slash commands.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const commands = ['ponytail-on-stimulants', 'ponytail-on-stimulants-review', 'ponytail-on-stimulants-audit', 'ponytail-on-stimulants-debt', 'ponytail-on-stimulants-gain', 'ponytail-on-stimulants-help'];
const skillCommands = commands.filter((name) => name !== 'ponytail-on-stimulants');

const root = path.join(__dirname, '..');

// ponytail-on-stimulants: probe once; on Windows `python3` is the Store-alias stub that fails
// even when Python is installed, so fall back to `python` (mirrors benchmarks/correctness.js).
let pythonCmd;
function pythonExe() {
  if (pythonCmd) return pythonCmd;
  for (const cmd of ['python3', 'python']) {
    if (spawnSync(cmd, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0) {
      return (pythonCmd = cmd);
    }
  }
  return (pythonCmd = 'python3');
}

function python(script, env = {}) {
  const result = spawnSync(pythonExe(), ['-c', script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`python failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

test('Hermes plugin manifest matches runtime skills, hooks, commands, and package version', () => {
  const manifestPath = path.join(root, 'plugin.yaml');
  assert.ok(fs.existsSync(manifestPath), 'missing root plugin.yaml');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const skillDirs = fs.readdirSync(path.join(root, 'skills'))
    .filter((name) => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')))
    .sort();

  assert.match(manifest, /^name:\s*ponytail-on-stimulants$/m);
  assert.match(manifest, new RegExp(`^version:\\s*${packageJson.version}$`, 'm'));
  assert.match(manifest, new RegExp(`^author:\\s*${packageJson.author.name}$`, 'm'));
  assert.deepEqual(commands.filter((name) => manifest.includes(`  - ${name}`)), commands);
  assert.deepEqual(skillDirs.filter((name) => manifest.includes(`  - ${name}`)), skillDirs);
  assert.match(manifest, /pre_llm_call/);
  assert.match(manifest, /pre_gateway_dispatch/);
});

test('Hermes plugin registers every shipped skill under the ponytail-on-stimulants namespace', () => {
  const output = python(String.raw`
import importlib.util, json, pathlib
spec = importlib.util.spec_from_file_location('PONYTAIL_ON_STIMULANTS_hermes_plugin', '__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Ctx:
    def __init__(self):
        self.skills = []
        self.hooks = []
        self.commands = []
    def register_skill(self, name, path):
        self.skills.append((name, pathlib.Path(path).as_posix()))
    def register_hook(self, name, handler):
        self.hooks.append(name)
    def register_command(self, name, handler, description='', args_hint=''):
        self.commands.append(name)
ctx = Ctx()
mod.register(ctx)
print(json.dumps({'skills': ctx.skills, 'hooks': ctx.hooks, 'commands': ctx.commands}, sort_keys=True))
`);
  const data = JSON.parse(output);
  assert.deepEqual(data.skills.map(([name]) => name).sort(), [
    'ponytail-on-stimulants',
    'ponytail-on-stimulants-audit',
    'ponytail-on-stimulants-debt',
    'ponytail-on-stimulants-gain',
    'ponytail-on-stimulants-help',
    'ponytail-on-stimulants-review',
  ]);
  assert.ok(data.skills.every(([, skillPath]) => skillPath.endsWith('/SKILL.md')));
  assert.ok(data.hooks.includes('pre_llm_call'));
  assert.ok(data.commands.includes('ponytail-on-stimulants'));
  assert.ok(data.commands.includes('ponytail-on-stimulants-review'));
});

test('Hermes plugin builds mode-aware injected context from the canonical skill', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-config-'));
  const output = python(String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('PONYTAIL_ON_STIMULANTS_hermes_plugin', '__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ctx = mod.build_injected_context('feral')
print(json.dumps({'ctx': ctx}))
`, { XDG_CONFIG_HOME: tmp });
  const { ctx } = JSON.parse(output);

  assert.match(ctx, /PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);
  assert.match(ctx, /Minimal architecture\. Maximal execution\./);
  assert.match(ctx, /^PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);
  assert.doesNotMatch(ctx, /^---/);
  assert.doesNotMatch(ctx, /^\|\s*\*\*focused\*\*/m);
});

test('Hermes mode config respects env, config file, off, and invalid command behavior', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-config-'));
  fs.mkdirSync(path.join(tmp, 'ponytail-on-stimulants'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ponytail-on-stimulants', 'config.json'), JSON.stringify({ defaultMode: 'focused' }));
  const output = python(String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('PONYTAIL_ON_STIMULANTS_hermes_plugin', '__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Ctx:
    def __init__(self): self.commands = {}
    def register_skill(self, name, path): pass
    def register_hook(self, name, handler): pass
    def register_command(self, name, handler, description='', args_hint=''):
        self.commands[name] = handler
ctx = Ctx()
mod.register(ctx)
status_before = ctx.commands['ponytail-on-stimulants']('status')
invalid = ctx.commands['ponytail-on-stimulants']('maximum')
default_result = ctx.commands['ponytail-on-stimulants']('default feral')
status_after = ctx.commands['ponytail-on-stimulants']('status')
print(json.dumps({
    'default': mod.build_injected_context(None),
    'off': mod.build_injected_context('off'),
    'status_before': status_before,
    'invalid': invalid,
    'default_result': default_result,
    'saved_default': json.loads((mod._config_dir() / 'config.json').read_text())['defaultMode'],
    'status_after': status_after,
}))
`, { XDG_CONFIG_HOME: tmp, PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'feral' });
  const data = JSON.parse(output);
  assert.match(data.default, /mode: feral/);
  assert.equal(data.off, '');
  assert.match(data.status_before, /current feral; default feral/);
  assert.match(data.invalid, /Usage:/);
  assert.match(data.default_result, /feral/);
  assert.equal(data.saved_default, 'feral');
  assert.match(data.status_after, /current feral; default feral/);
});

test('Hermes /ponytail-on-stimulants command changes mode and pre_llm_call injects current context', () => {
  const output = python(String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('PONYTAIL_ON_STIMULANTS_hermes_plugin', '__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Ctx:
    def __init__(self):
        self.hooks = {}
        self.commands = {}
    def register_skill(self, name, path): pass
    def register_hook(self, name, handler): self.hooks[name] = handler
    def register_command(self, name, handler, description='', args_hint=''):
        self.commands[name] = handler
ctx = Ctx()
mod.register(ctx)
message = ctx.commands['ponytail-on-stimulants']('feral')
injected = ctx.hooks['pre_llm_call'](session_id='s1', user_message='build it', conversation_history=[], is_first_turn=False, model='m', platform='cli')
print(json.dumps({'message': message, 'context': injected['context']}))
`);
  const data = JSON.parse(output);
  assert.match(data.message, /feral/);
  assert.match(data.context, /PONYTAIL ON STIMULANTS ACTIVE — mode: feral/);
});

test('Hermes gateway rewrite respects slash access denial', () => {
  const output = python(String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('PONYTAIL_ON_STIMULANTS_hermes_plugin', '__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Source:
    platform = None
    chat_id = 'c1'
    user_id = 'u1'
class Event:
    text = '/ponytail-on-stimulants-review src/app.js'
    source = Source()
class Gateway:
    def _check_slash_access(self, source, command):
        return 'denied'
result = mod.rewrite_gateway_command(event=Event(), gateway=Gateway())
print(json.dumps(result))
`);
  assert.equal(output, 'null');
});

test('Hermes gateway rewrite preserves every skill command and ignores unrelated text', () => {
  const output = python(String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('PONYTAIL_ON_STIMULANTS_hermes_plugin', '__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Event:
    def __init__(self, text): self.text = text
cases = {}
for text in ['/ponytail-on-stimulants-review x', '/ponytail-on-stimulants-audit repo', '/ponytail-on-stimulants-debt', '/ponytail-on-stimulants-help', '/status', 'hello']:
    cases[text] = mod.rewrite_gateway_command(event=Event(text))
print(json.dumps(cases, sort_keys=True))
`);
  const data = JSON.parse(output);
  assert.match(data['/ponytail-on-stimulants-review x'].text, /ponytail-on-stimulants-review/);
  assert.match(data['/ponytail-on-stimulants-audit repo'].text, /ponytail-on-stimulants-audit/);
  assert.match(data['/ponytail-on-stimulants-audit repo'].text, /repo/);
  assert.match(data['/ponytail-on-stimulants-debt'].text, /ponytail-on-stimulants-debt/);
  assert.match(data['/ponytail-on-stimulants-help'].text, /ponytail-on-stimulants-help/);
  assert.equal(data['/status'], null);
  assert.equal(data.hello, null);
});
