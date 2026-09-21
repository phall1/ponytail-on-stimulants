#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures', 'agent-plugins', '1.0.0');
const pluginSchema = readJson(path.join(fixtures, 'plugin.schema.json'));
const mcpSchema = readJson(path.join(fixtures, 'mcp.schema.json'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function schemaAtRef(schema, ref) {
  assert.match(ref, /^#\//, `unsupported schema reference ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => value[key], schema);
}

function validate(value, rule, rootSchema, location = '$') {
  if (rule.$ref) return validate(value, schemaAtRef(rootSchema, rule.$ref), rootSchema, location);
  if (rule.oneOf) {
    const matches = rule.oneOf.filter((candidate) => validate(value, candidate, rootSchema, location).length === 0);
    return matches.length === 1 ? [] : [`${location}: expected exactly one oneOf match`];
  }
  if (rule.not && validate(value, rule.not, rootSchema, location).length === 0) return [`${location}: matched forbidden schema`];
  if (rule.const !== undefined && value !== rule.const) return [`${location}: expected ${JSON.stringify(rule.const)}`];
  if (rule.enum && !rule.enum.includes(value)) return [`${location}: value is not in enum`];

  const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (rule.type && actualType !== rule.type) return [`${location}: expected ${rule.type}, got ${actualType}`];
  const errors = [];
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${location}: shorter than minLength`);
    if (rule.maxLength !== undefined && value.length > rule.maxLength) errors.push(`${location}: longer than maxLength`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${location}: does not match pattern`);
  }
  if (Array.isArray(value) && rule.items) {
    value.forEach((item, index) => errors.push(...validate(item, rule.items, rootSchema, `${location}[${index}]`)));
  }
  if (actualType === 'object') {
    for (const key of rule.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${location}: missing ${key}`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (rule.propertyNames) errors.push(...validate(key, rule.propertyNames, rootSchema, `${location} key ${key}`));
      if (rule.properties && rule.properties[key]) {
        errors.push(...validate(entry, rule.properties[key], rootSchema, `${location}.${key}`));
      } else if (rule.additionalProperties === false) {
        errors.push(`${location}: unknown property ${key}`);
      } else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') {
        errors.push(...validate(entry, rule.additionalProperties, rootSchema, `${location}.${key}`));
      }
    }
  }
  return errors;
}

function frontmatter(skillFile) {
  const text = fs.readFileSync(skillFile, 'utf8');
  const block = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(block, `${skillFile} must start with YAML frontmatter`);
  const name = block[1].match(/^name:\s*([^\n]+)$/m);
  const description = block[1].match(/^description:\s*([^\n]+)(?:\n(?:  .+\n?)*)?/m);
  assert.ok(name, `${skillFile} must declare name`);
  assert.ok(description, `${skillFile} must declare description`);
  return {
    name: name[1].trim().replace(/^['"]|['"]$/g, ''),
    description: description[1].trim(),
  };
}

test('vendored Agent Plugins v1.0.0 schemas are the official immutable files', () => {
  assert.equal(pluginSchema.$id, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(mcpSchema.$id, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(digest(path.join(fixtures, 'plugin.schema.json')), '0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883');
  assert.equal(digest(path.join(fixtures, 'mcp.schema.json')), '6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb');
});

test('canonical plugin and MCP manifests conform to the official closed schemas', () => {
  const plugin = readJson(path.join(root, 'plugin.json'));
  const mcp = readJson(path.join(root, 'mcp.json'));
  assert.deepEqual(validate(plugin, pluginSchema, pluginSchema), []);
  assert.deepEqual(validate(mcp, mcpSchema, mcpSchema), []);
  assert.equal(plugin.version, '0.2.0');
  assert.equal(plugin.name, 'ponytail-on-stimulants');
});

test('schema validator rejects closed-manifest and MCP mutations', () => {
  const plugin = readJson(path.join(root, 'plugin.json'));
  const mcp = readJson(path.join(root, 'mcp.json'));
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const unknownPluginField = clone(plugin);
  unknownPluginField.obsolete = true;
  assert.notDeepEqual(validate(unknownPluginField, pluginSchema, pluginSchema), []);

  const missingName = clone(plugin);
  delete missingName.name;
  assert.notDeepEqual(validate(missingName, pluginSchema, pluginSchema), []);

  const missingCommand = clone(mcp);
  delete missingCommand.mcpServers['ponytail-on-stimulants'].command;
  assert.notDeepEqual(validate(missingCommand, mcpSchema, mcpSchema), []);

  for (const reserved of ['PLUGIN_ROOT', 'PLUGIN_DATA']) {
    const reservedEnvironment = clone(mcp);
    reservedEnvironment.mcpServers['ponytail-on-stimulants'].env = { [reserved]: 'forbidden' };
    assert.notDeepEqual(validate(reservedEnvironment, mcpSchema, mcpSchema), []);
  }
});

test('portable components use the v1 fixed layout and exact skill names', () => {
  const skillsRoot = path.join(root, 'skills');
  const resolvedRoot = `${fs.realpathSync(root)}${path.sep}`;
  const directories = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, [
    'ponytail-on-stimulants',
    'ponytail-on-stimulants-audit',
    'ponytail-on-stimulants-debt',
    'ponytail-on-stimulants-gain',
    'ponytail-on-stimulants-help',
    'ponytail-on-stimulants-review',
  ]);
  for (const directory of directories) {
    assert.match(directory, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const skillFile = path.join(skillsRoot, directory, 'SKILL.md');
    assert.ok(fs.statSync(skillFile).isFile(), `${directory} must contain SKILL.md`);
    assert.ok(fs.realpathSync(skillFile).startsWith(resolvedRoot), `${directory} must stay inside plugin root`);
    const metadata = frontmatter(skillFile);
    assert.equal(metadata.name, directory, `${directory} frontmatter name`);
    assert.ok(metadata.description, `${directory} description`);
  }

  const mcp = readJson(path.join(root, 'mcp.json'));
  const server = mcp.mcpServers['ponytail-on-stimulants'];
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/mcp/server.js']);
  assert.ok(fs.statSync(path.join(root, 'mcp', 'server.js')).isFile());
});
