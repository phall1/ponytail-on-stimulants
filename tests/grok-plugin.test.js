#!/usr/bin/env node
// Grok Build loads ponytail-on-stimulants through its native skill system. Lifecycle-hook
// stdout is passive in Grok, so this adapter must not register any hooks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('Grok manifest is a skill-only adapter with no lifecycle hooks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'ponytail-on-stimulants');
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.ok(!fs.existsSync(path.join(root, 'hooks', 'hooks.json')));
  assert.ok(!fs.existsSync(path.join(root, '.grok-plugin', 'hooks.json')));
});

test('ponytail-on-stimulants skill describes every coding task for Grok auto-invocation', () => {
  const skill = fs.readFileSync(path.join(root, 'skills', 'ponytail-on-stimulants', 'SKILL.md'), 'utf8');
  assert.match(skill, /finish coding tasks with proportional verification/i);
  assert.match(skill, /Understand[\s\S]*Design[\s\S]*Execute[\s\S]*Verify[\s\S]*Adversarial second pass/i);
  assert.doesNotMatch(skill, /disable-model-invocation:\s*true/i);
});
