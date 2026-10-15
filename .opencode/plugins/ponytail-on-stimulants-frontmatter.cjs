'use strict';

// Keep shared parsers outside the module's single plugin-definition export.
// Legacy OpenCode loaders treat every exported function as a plugin entry.

function parseCommandFile(filePath) {
  const fs = require('fs');
  const content = fs.readFileSync(filePath, 'utf8');
  // Tolerate CRLF: a Windows checkout (autocrlf) delivers \r\n, npm ships \n.
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const description = frontmatterField(match[1], 'description');
  return { description, template: match[2].trim() };
}

// Flat fields and block descriptions cover our shipped skills; not a YAML parser.
function blockValue(lines, style) {
  const block = [];
  for (const line of lines) {
    if (line.trim() && !/^\s/.test(line)) break;
    block.push(line.trim());
  }
  const joined = block.join(style[0] === '|' ? '\n' : ' ').trimEnd();
  return style.endsWith('-') ? joined : joined + '\n';
}

function frontmatterField(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(key + ':'));
  if (at === -1) return undefined;
  const value = lines[at].slice(key.length + 1).trim();
  if (/^[>|]/.test(value)) return blockValue(lines.slice(at + 1), value);
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function parseSkillFile(filePath) {
  const fs = require('node:fs');
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[^\S\n]*\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return {
    name: frontmatterField(match[1], 'name'),
    description: frontmatterField(match[1], 'description'),
    body: match[2],
  };
}

module.exports = { parseCommandFile, parseSkillFile };
