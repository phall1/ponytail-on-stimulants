# Agent portability

Ponytail on Stimulants uses the published Agent Plugins v1.0.0 fixed layout as its portable core:

- `plugin.json` contains the canonical closed manifest;
- `skills/*/SKILL.md` contains Agent Skills whose frontmatter names match their directories;
- `mcp.json` declares the dependency-free `mcp/server.js` stdio server.

The npm artifact preserves that layout and the MCP server runs from an extracted package without installing dependencies.

Current native adapters supply behavior that Agent Plugins v1.0.0 does not standardize:

| Host | Native adapter | Behavior |
|------|----------------|----------|
| Oh My Pi | `.omp-plugin/`, `package.json` `omp.extensions` | Marketplace install loads the same `pi-extension` + `completion-gate/` loop Pi uses. |
| Claude Code / Codex | `.claude-plugin/`, `.codex-plugin/`, `hooks/claude-codex-hooks.json`, `hooks/codex-hooks.json` | Session/prompt/subagent injection plus a file-hook Stop completion gate (Claude `additionalContext`, Codex `decision: block`). |
| GitHub Copilot CLI | `com.github.copilot/hooks/hooks.json`, `.github/plugin/` compatibility | Portable skills/MCP plus native startup injection. Prompt-hook output does not inject context. |
| Pi | `pi-extension/`, `completion-gate/` | Per-turn instructions, fork commands/status, and the bounded operational completion loop. |
| OpenCode | `.opencode/plugins/ponytail-on-stimulants.mjs` | V2 context/compaction hooks, commands/skills transforms and post-execution continuation. V1 retains system transforms and post-idle continuation. Both are bounded best-effort, not in-loop stop vetoes. |
| Hermes | `plugin.yaml`, `__init__.py` | `pre_llm_call`, gateway command rewriting, skills, and fork commands. |
| Gemini / Qwen Code | `gemini-extension.json`, `AGENTS.md`, `commands/`, `skills/` | Extension context plus commands/skills. |
| Qoder | `.qoder-plugin/`, `.qoder/rules/`, `hooks/qoder-hooks.json` | Static rule or prompt/subagent hook injection. |
| Cursor | `hooks/cursor-hooks.json`, `scripts/cursor-hooks.js`, `.cursor/rules/ponytail-on-stimulants.mdc` | Session-start context; prompt hooks save mode for the next local chat. Static rule is an alternative. |
| Grok / Devin / OpenClaw | host manifests plus `skills/` | Fork-namespaced skill distribution. OpenClaw copies are generated. |
| Windsurf / Cline / Kiro / editor Copilot | uniquely named static rule files | Instruction-only behavior. |

Pi and Oh My Pi share the in-process continuation gate. Claude Code and Codex implement the strongest honest Stop-hook adapter their hosts expose. OpenCode queues a prompt after successful execution (V2) or idle (V1); neither adapter claims a documented in-loop stopping hook. Other adapters inject the same stopping contract and do not fake a lifecycle they lack.

## Canonical and generated sources

- `skills/ponytail-on-stimulants/SKILL.md` — full runtime behavior.
- `AGENTS.md` — compact static-rule source.
- `.cursor`, `.windsurf`, `.clinerules`, `.agents`, `.qoder`, `.github/copilot-instructions.md`, `.kiro` — checked copies of `AGENTS.md`.
- `.openclaw/skills/` — generated from `skills/` by `scripts/build-openclaw-skills.js`.
- `hooks/ponytail-on-stimulants-instructions.js` — shared native-adapter mode filter/builder.

Validate copy integrity with `node scripts/check-rule-copies.js` and portable layout conformance with `npm test`.
