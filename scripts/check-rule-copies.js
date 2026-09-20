#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n').trim();
const stripFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
const agents = read('AGENTS.md');
const canonical = agents.replace(/\n\n\(Yes, this file applies[\s\S]*?\)$/, '').trim();
const copies = [
  ['.cursor/rules/ponytail-on-stimulants.mdc', stripFrontmatter],
  ['.windsurf/rules/ponytail-on-stimulants.md', (text) => text.trim()],
  ['.clinerules/ponytail-on-stimulants.md', (text) => text.trim()],
  ['.agents/rules/ponytail-on-stimulants.md', (text) => text.trim()],
  ['.qoder/rules/ponytail-on-stimulants.md', (text) => text.trim()],
  ['.github/copilot-instructions.md', (text) => text.trim()],
  ['.kiro/steering/ponytail-on-stimulants.md', stripFrontmatter],
];

let failed = false;
for (const [relative, normalize] of copies) {
  if (normalize(read(relative)) !== canonical) {
    console.error(`${relative} drifted from AGENTS.md`);
    failed = true;
  }
}

const invariants = [
  'Minimal architecture. Maximal execution.',
  'mechanically implied work',
  'Adversarial second pass',
  'proportion to blast radius',
  'input validation',
  'prevents data loss',
  'security',
  'accessibility',
  'Unbounded persistence. Bounded scope.',
];
const skill = read('skills/ponytail-on-stimulants/SKILL.md');
for (const phrase of invariants) {
  for (const [label, text] of [['skills/ponytail-on-stimulants/SKILL.md', skill], ['AGENTS.md', agents]]) {
    if (!text.toLowerCase().includes(phrase.toLowerCase())) {
      console.error(`${label} is missing rule invariant: "${phrase}"`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`Rule copies match AGENTS.md; ${invariants.length} completion invariants are present.`);
