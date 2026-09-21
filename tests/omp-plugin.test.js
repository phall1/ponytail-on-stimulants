#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function validName(value) {
  return typeof value === 'string' &&
    /^[a-z0-9][a-z0-9.-]{0,62}[a-z0-9]$/.test(value) &&
    value.length <= 64;
}

test('OMP marketplace catalog lives at the preferred .omp-plugin path', () => {
  const catalog = readJson('.omp-plugin/marketplace.json');
  assert.equal(catalog.name, 'ponytail-on-stimulants');
  assert.equal(catalog.owner.name, 'phall1');
  assert.ok(Array.isArray(catalog.plugins));
  assert.equal(catalog.plugins.length, 1);
  const plugin = catalog.plugins[0];
  assert.equal(plugin.name, 'ponytail-on-stimulants');
  assert.equal(plugin.source, './');
  assert.ok(validName(catalog.name));
  assert.ok(validName(plugin.name));
  assert.match(plugin.description, /completion/i);
});

test('OMP plugin manifest is distinct from upstream ponytail and lists skills', () => {
  const manifest = readJson('.omp-plugin/plugin.json');
  assert.equal(manifest.name, 'ponytail-on-stimulants');
  assert.equal(manifest.version, readJson('package.json').version);
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.hooks, undefined);
});

test('package.json wires OMP to the same Pi completion-gate extension', () => {
  const pkg = readJson('package.json');
  assert.deepEqual(pkg.omp.extensions, ['./pi-extension/index.js']);
  assert.deepEqual(pkg.omp.extensions, pkg.pi.extensions);
  assert.ok(fs.existsSync(path.join(root, 'pi-extension', 'index.js')));
  assert.ok(pkg.files.includes('.omp-plugin/'));
});

test('Claude marketplace catalog remains as the OMP fallback / dual-publish path', () => {
  const claude = readJson('.claude-plugin/marketplace.json');
  assert.equal(claude.name, 'ponytail-on-stimulants');
  assert.equal(claude.owner.name, 'phall1');
  assert.equal(claude.plugins[0].name, 'ponytail-on-stimulants');
  assert.equal(claude.plugins[0].source, './');
});

test('README documents the verified OMP marketplace install commands', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /omp plugin marketplace add phall1\/ponytail-on-stimulants/);
  assert.match(readme, /omp plugin install ponytail-on-stimulants@ponytail-on-stimulants/);
  assert.match(readme, /Oh My Pi|\bOMP\b/);
});
