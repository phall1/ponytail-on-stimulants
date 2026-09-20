// Pure instruction selection for the Ponytail on Stimulants MCP server.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require('../hooks/ponytail-on-stimulants-instructions.js');
const { DEFAULT_MODE, getDefaultMode, normalizeMode } = require('../hooks/ponytail-on-stimulants-config.js');

export const MODES = ['focused', 'full-send', 'feral'];
export const MODE_INPUTS = [...MODES, 'lite', 'full', 'ultra'];

export function resolveMode(requested) {
  const asked = normalizeMode(requested);
  if (asked && asked !== 'off') return asked;
  const fallback = normalizeMode(getDefaultMode());
  return fallback && fallback !== 'off' ? fallback : DEFAULT_MODE;
}

export function buildInstructions(requested) {
  return getPonytailInstructions(resolveMode(requested));
}
