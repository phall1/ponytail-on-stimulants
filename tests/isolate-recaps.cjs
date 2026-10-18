'use strict';

// Preloaded by test scripts: route recaps from every in-process and spawned
// hook to a throwaway file so tests never append to the user's real index.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-on-stimulants-recaps-'));
  process.env.PONYTAIL_ON_STIMULANTS_RECAP_FILE = path.join(dir, 'recaps.tsv');
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}
