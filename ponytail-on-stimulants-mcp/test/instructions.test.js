import assert from "node:assert/strict";
import test from "node:test";

import { MODE_INPUTS, MODES, resolveMode, buildInstructions } from "../instructions.js";

test("resolveMode keeps valid intensities", () => {
  for (const mode of MODES) assert.equal(resolveMode(mode), mode);
});

test("public mode inputs include and canonicalize legacy aliases", () => {
  assert.deepEqual(MODE_INPUTS, ['focused', 'full-send', 'feral', 'lite', 'full', 'ultra']);
  assert.equal(resolveMode('lite'), 'focused');
  assert.equal(resolveMode('full'), 'full-send');
  assert.equal(resolveMode('ultra'), 'feral');
});

test("resolveMode falls back to a runtime intensity for off/unknown/empty", () => {
  // PONYTAIL_ON_STIMULANTS_DEFAULT_MODE could be anything in CI, so just assert the contract:
  // never returns "off", "review", or junk — always one of the served modes.
  for (const input of ["off", "review", "nonsense", "", undefined, null]) {
    assert.ok(MODES.includes(resolveMode(input)), `resolveMode(${input}) must be a served mode`);
  }
});

test("buildInstructions returns the ruleset tagged with the resolved mode", () => {
  const text = buildInstructions("ultra");
  assert.match(text, /PONYTAIL ON STIMULANTS ACTIVE/);
  assert.match(text, /mode: feral/);
});
