# ponytail-on-stimulants-mcp

Private development adapter exposing the canonical Ponytail on Stimulants instructions over MCP stdio.

- Prompt: `ponytail-on-stimulants`
- Tool: `ponytail_on_stimulants_instructions`
- Modes: `focused`, `full-send`, `feral`

Mode resolution reuses `hooks/ponytail-on-stimulants-config.js`, including `PONYTAIL_ON_STIMULANTS_DEFAULT_MODE` and the fork-specific config directory.

```sh
npm install
npm test
node index.js
```

Example client entry:

```json
{
  "mcpServers": {
    "ponytail-on-stimulants": {
      "command": "node",
      "args": ["ponytail-on-stimulants-mcp/index.js"]
    }
  }
}
```
