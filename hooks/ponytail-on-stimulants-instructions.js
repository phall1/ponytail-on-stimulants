#!/usr/bin/env node
// Shared Ponytail on Stimulants instruction builder for hooks and adapters.

const fs = require('fs');
const path = require('path');
const { DEFAULT_MODE, normalizeMode } = require('./ponytail-on-stimulants-config');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'ponytail-on-stimulants', 'SKILL.md');

function stripFrontmatter(body) {
  return String(body || '').replace(/^---[\s\S]*?---\s*/, '');
}

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  const withoutFrontmatter = stripFrontmatter(body);

  return withoutFrontmatter
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }
      const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }
      return true;
    })
    .join('\n');
}

function getFallbackInstructions(mode) {
  return `PONYTAIL ON STIMULANTS ACTIVE — mode: ${mode}\n\n` +
    'Minimal architecture. Maximal execution. Understand the repository and trace affected paths; choose the smallest sound design; implement the complete requested outcome and mechanically implied work; run proportionate verification; then perform an adversarial second pass before stopping. Fix root causes and sibling paths, investigate failures, keep scope bounded, and never simplify away security, data-loss protection, accessibility, trust-boundary validation, or explicit requirements.';
}

function getPonytailInstructions(mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  try {
    return `PONYTAIL ON STIMULANTS ACTIVE — mode: ${effectiveMode}\n\n` +
      filterSkillBodyForMode(fs.readFileSync(SKILL_PATH, 'utf8'), effectiveMode);
  } catch (_) {
    return getFallbackInstructions(effectiveMode);
  }
}

module.exports = {
  filterSkillBodyForMode,
  getFallbackInstructions,
  getPonytailInstructions,
};
