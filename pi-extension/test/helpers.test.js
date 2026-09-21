import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  filterSkillBodyForMode,
  parsePonytailCommand,
  readDefaultMode,
  resolveSessionMode,
  writeDefaultMode,
} from '../index.js';

test('command parser accepts only canonical modes and commands', () => {
  assert.deepEqual(parsePonytailCommand('focused'), { type: 'set-mode', mode: 'focused' });
  assert.deepEqual(parsePonytailCommand('full-send'), { type: 'set-mode', mode: 'full-send' });
  assert.deepEqual(parsePonytailCommand('feral'), { type: 'set-mode', mode: 'feral' });
  assert.deepEqual(parsePonytailCommand('default feral'), { type: 'set-default', mode: 'feral' });
  assert.deepEqual(parsePonytailCommand('default review'), { type: 'invalid', reason: 'invalid-default-mode' });
  assert.deepEqual(parsePonytailCommand('maximum'), { type: 'invalid', reason: 'invalid-mode', mode: 'maximum' });
  assert.deepEqual(parsePonytailCommand('status'), { type: 'status' });
  assert.deepEqual(parsePonytailCommand('', 'off'), { type: 'set-mode', mode: 'full-send' });
});

test('session mode uses only fork-specific entries with canonical values', () => {
  const entries = [
    { type: 'custom', customType: 'other-mode', data: { mode: 'focused' } },
    { type: 'custom', customType: 'ponytail-on-stimulants-mode', data: { mode: 'feral' } },
  ];
  assert.equal(resolveSessionMode(entries), 'feral');
  assert.equal(resolveSessionMode(null, 'focused'), 'focused');
});

test('default config uses fork-specific XDG directory and canonical values', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ponytail-on-stimulants-config-'));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousDefault = process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = temp;
  delete process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
  try {
    assert.equal(readDefaultMode(), 'full-send');
    assert.equal(writeDefaultMode('feral'), 'feral');
    assert.equal(readDefaultMode(), 'feral');
    const configPath = join(temp, 'ponytail-on-stimulants', 'config.json');
    assert.ok(existsSync(configPath));
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { defaultMode: 'feral' });
    assert.equal(existsSync(join(temp, 'ponytail', 'config.json')), false);
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousDefault === undefined) delete process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
    else process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE = previousDefault;
    rmSync(temp, { recursive: true, force: true });
  }
});

test('fork environment variable overrides config', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ponytail-on-stimulants-env-'));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousDefault = process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
  process.env.XDG_CONFIG_HOME = temp;
  mkdirSync(join(temp, 'ponytail-on-stimulants'), { recursive: true });
  writeFileSync(join(temp, 'ponytail-on-stimulants', 'config.json'), JSON.stringify({ defaultMode: 'focused' }));
  process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE = 'feral';
  try {
    assert.equal(readDefaultMode(), 'feral');
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousDefault === undefined) delete process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE;
    else process.env.PONYTAIL_ON_STIMULANTS_DEFAULT_MODE = previousDefault;
    rmSync(temp, { recursive: true, force: true });
  }
});

test('skill filter keeps only the requested canonical mode row and example', () => {
  const body = `---\nname: x\n---\n| **focused** | a |\n| **full-send** | b |\n| **feral** | c |\n- focused: "a"\n- full-send: "b"\n- feral: "c"\nMechanically implied work`;
  const filtered = filterSkillBodyForMode(body, 'feral');
  assert.doesNotMatch(filtered, /\*\*focused\*\*/);
  assert.doesNotMatch(filtered, /\*\*full-send\*\*/);
  assert.match(filtered, /\*\*feral\*\*/);
  assert.match(filtered, /Mechanically implied work/);
});
