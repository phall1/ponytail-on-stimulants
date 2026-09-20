#!/usr/bin/env node
// Ponytail on Stimulants MCP server: serves the completion rules over stdio.
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { MODE_INPUTS, buildInstructions, resolveMode } from './instructions.js';

const { version } = JSON.parse(
  await fs.promises.readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const server = new McpServer({ name: 'ponytail-on-stimulants', version });
const modeArg = z.enum(MODE_INPUTS).optional().describe(
  'Execution mode: focused, full-send, or feral (legacy aliases: lite, full, ultra). Omit for the configured default.',
);

server.registerPrompt(
  'ponytail-on-stimulants',
  {
    title: 'Ponytail on Stimulants mode',
    description: 'Minimal architecture, maximal execution instructions.',
    argsSchema: { mode: modeArg },
  },
  ({ mode }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: buildInstructions(mode) } }],
  }),
);

server.registerTool(
  'ponytail_on_stimulants_instructions',
  {
    title: 'Ponytail on Stimulants instructions',
    description: 'Return the completion ruleset for focused, full-send, or feral mode.',
    inputSchema: { mode: modeArg },
    outputSchema: { mode: z.string(), instructions: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ mode }) => {
    const resolvedMode = resolveMode(mode);
    const instructions = buildInstructions(resolvedMode);
    const structuredContent = { mode: resolvedMode, instructions };
    return { content: [{ type: 'text', text: instructions }], structuredContent };
  },
);

await server.connect(new StdioServerTransport());
