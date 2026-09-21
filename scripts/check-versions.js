#!/usr/bin/env node
// Fork version guard: every manifest must match, and release tags must be exact.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const semver = /^\d+\.\d+\.\d+$/;
const jsonFiles = [
  'plugin.json',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.devin-plugin/plugin.json',
  '.github/plugin/plugin.json',
  '.omp-plugin/plugin.json',
  '.qoder-plugin/plugin.json',
  'gemini-extension.json',
  'package.json',
];

function jsonVersion(relative) {
  const raw = fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw).version;
}

function yamlVersion(relative) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  const match = text.match(/^version:\s*([^\s#]+)\s*$/m);
  return match && match[1];
}

const versions = jsonFiles.map((file) => [file, jsonVersion(file)]);
versions.push(['plugin.yaml', yamlVersion('plugin.yaml')]);
let failed = false;
for (const [file, version] of versions) {
  if (!semver.test(String(version || ''))) {
    console.error(`${file}: version must be pinned X.Y.Z, got ${JSON.stringify(version)}`);
    failed = true;
  }
}
const distinct = [...new Set(versions.map(([, version]) => version))];
if (distinct.length !== 1) {
  console.error('Version mismatch:');
  for (const [file, version] of versions) console.error(`  ${version}\t${file}`);
  failed = true;
}

const shared = distinct.length === 1 ? distinct[0] : null;
if (shared && process.env.GITHUB_REF_TYPE === 'tag') {
  const expected = `v${shared}`;
  if (process.env.GITHUB_REF_NAME !== expected) {
    console.error(`release tag must be exactly ${expected}, got ${process.env.GITHUB_REF_NAME || '(missing)'}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`All ${versions.length} version files pinned at ${shared}.`);
