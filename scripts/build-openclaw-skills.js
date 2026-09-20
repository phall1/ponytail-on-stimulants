#!/usr/bin/env node
// Generate OpenClaw skill packages from canonical skills/*/SKILL.md.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOMEPAGE = 'https://github.com/phall1/ponytail-on-stimulants';
const DESCRIPTIONS = {
  'ponytail-on-stimulants': 'Minimal architecture, maximal execution for coding tasks: finish implied work, verify proportionately, and run a bounded completion pass.',
  'ponytail-on-stimulants-review': 'Review a diff for unfinished execution and unjustified complexity, with concrete caller, verification, and scope findings.',
  'ponytail-on-stimulants-audit': 'Audit a repository for incomplete paths, verification gaps, generated drift, and unjustified complexity.',
  'ponytail-on-stimulants-debt': 'Harvest deliberate ponytail-on-stimulants shortcut comments into a bounded debt ledger.',
  'ponytail-on-stimulants-gain': 'Show inherited upstream benchmark evidence separately from fork completion metrics.',
  'ponytail-on-stimulants-help': 'Quick reference for Ponytail on Stimulants modes, skills, configuration, and completion gate.',
};
const NAMES = Object.keys(DESCRIPTIONS);

function sourceBody(name) {
  const source = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const frontmatter = source.match(/^---\n[\s\S]*?\n---\n?/);
  if (!frontmatter) throw new Error(`skills/${name}/SKILL.md has no frontmatter`);
  return source.slice(frontmatter[0].length);
}

function render(name) {
  const description = DESCRIPTIONS[name];
  if (description.length > 160 || description.includes('\n') || description.includes('"')) {
    throw new Error(`description for ${name} must be one line, no quotes, under 160 chars`);
  }
  return `---\nname: ${name}\ndescription: "${description}"\nhomepage: ${HOMEPAGE}\nlicense: MIT\n---\n${sourceBody(name)}`;
}

function outPath(name) {
  return path.join(ROOT, '.openclaw', 'skills', name, 'SKILL.md');
}

module.exports = { DESCRIPTIONS, NAMES, render, outPath, sourceBody };

if (require.main === module) {
  for (const name of NAMES) {
    const output = outPath(name);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, render(name));
    console.log('wrote', path.relative(ROOT, output).replace(/\\/g, '/'));
  }
}
