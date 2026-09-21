#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
}

test('packed plugin runs its dependency-free MCP server over stdio', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-agent-plugin-'));
  try {
    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', temp], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(packed.status, 0, packed.stderr);
    const filename = JSON.parse(packed.stdout)[0].filename;
    const archive = path.join(temp, filename);
    const extracted = path.join(temp, 'extracted');
    fs.mkdirSync(extracted);
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(unpack.status, 0, unpack.stderr);
    const pluginRoot = path.join(extracted, 'package');

    for (const relative of [
      'plugin.json',
      'mcp.json',
      'mcp/server.js',
      'skills/ponytail-on-stimulants/SKILL.md',
    ]) {
      assert.ok(fs.existsSync(path.join(pluginRoot, relative)), `${relative} missing from npm artifact`);
    }
    assert.equal(fs.existsSync(path.join(pluginRoot, 'node_modules')), false);

    const initialize = {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1' },
    };
    const requests = [
      rpc(1, 'tools/list', {}),
      rpc(2, 'initialize', null),
      rpc(3, 'initialize', initialize),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      rpc(4, 'prompts/list', {}),
      rpc(5, 'prompts/get', { name: 'ponytail-on-stimulants', arguments: { mode: 'focused' } }),
      rpc(6, 'tools/list', {}),
      rpc(7, 'tools/call', { name: 'ponytail_on_stimulants_instructions', arguments: { mode: 'feral' } }),
      rpc(8, 'tools/call', { name: 'ponytail_on_stimulants_instructions', arguments: { mode: 'unsupported' } }),
      rpc(9, 'unknown/method', {}),
      rpc(10, 'tools/call', { name: 'ponytail_on_stimulants_instructions', arguments: {} }),
      rpc(11, 'initialize', initialize),
      rpc(12, 'notifications/initialized'),
      JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }),
      JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'ping' }),
      JSON.stringify({ jsonrpc: '2.0', id: true, method: 'ping' }),
      rpc(13, 'constructor', {}),
    ].join('\n') + '\n';
    const server = spawnSync(process.execPath, [path.join(pluginRoot, 'mcp', 'server.js')], {
      cwd: pluginRoot,
      env: {
        ...process.env,
        PLUGIN_ROOT: pluginRoot,
        PLUGIN_DATA: path.join(temp, 'data'),
        PONYTAIL_ON_STIMULANTS_DEFAULT_MODE: 'focused',
      },
      input: requests,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(server.status, 0, server.stderr);
    const responses = server.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      responses.map((response) => response.id),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, null, null, null, 13],
    );
    assert.equal(responses[0].error.code, -32002);
    assert.equal(responses[1].error.code, -32602);
    assert.equal(responses[2].result.protocolVersion, '2024-11-05');
    assert.equal(responses[2].result.serverInfo.version, '0.2.0');
    assert.deepEqual(responses[2].result.capabilities, {
      prompts: { listChanged: false },
      tools: { listChanged: false },
    });
    assert.deepEqual(responses[3].result.prompts.map((prompt) => prompt.name), ['ponytail-on-stimulants']);
    assert.match(responses[4].result.messages[0].content.text, /mode: focused/);
    assert.deepEqual(
      responses[5].result.tools[0].inputSchema.properties.mode.enum,
      ['focused', 'full-send', 'feral'],
    );
    assert.match(responses[5].result.tools[0].inputSchema.properties.mode.description, /configured default/);
    assert.match(responses[6].result.content[0].text, /mode: feral/);
    assert.equal(responses[7].error.code, -32602);
    assert.equal(responses[8].error.code, -32601);
    assert.match(responses[9].result.content[0].text, /mode: focused/);
    assert.equal(responses[10].error.code, -32600);
    assert.equal(responses[11].error.code, -32600);
    assert.deepEqual(responses.slice(12, 15).map((response) => response.error.code), [-32600, -32600, -32600]);
    assert.equal(responses[15].error.code, -32601);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
