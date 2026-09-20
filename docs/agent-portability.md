# Agent portability

Ponytail on Stimulants preserves upstream Ponytail's multi-host layout while using a collision-free fork identity.

| Host | Adapter | Behavior |
|------|---------|----------|
| Claude Code / Codex | `.claude-plugin/`, `.codex-plugin/`, `hooks/claude-codex-hooks.json` | Session, prompt, and subagent instruction injection. |
| GitHub Copilot CLI | `.github/plugin/`, `hooks/copilot-hooks.json` | Plugin commands plus session injection; static rules remain a fallback. |
| Pi | `pi-extension/`, `completion-gate/` | Per-turn instructions, fork commands/status, and the bounded operational completion loop. |
| OpenCode | `.opencode/plugins/ponytail-on-stimulants.mjs` | Per-turn system transform and persistent fork mode. |
| Hermes | `plugin.yaml`, `__init__.py` | `pre_llm_call`, gateway command rewriting, skills, and fork commands. |
| Gemini / Antigravity | `gemini-extension.json`, `AGENTS.md`, `commands/`, `skills/` | Extension context plus commands/skills. |
| Qoder | `.qoder-plugin/`, `.qoder/rules/`, `hooks/qoder-hooks.json` | Static rule or prompt/subagent hook injection. |
| Cursor | `hooks/cursor-hooks.json`, `scripts/cursor-hooks.js`, `.cursor/rules/ponytail-on-stimulants.mdc` | Native session/prompt hooks or a uniquely named static-rule alternative. |
| Grok / Devin / OpenClaw | host manifests plus `skills/` | Fork-namespaced skill distribution. OpenClaw copies are generated. |
| Windsurf / Cline / Kiro / editor Copilot | uniquely named static rule files | Instruction-only behavior. |
| MCP-only hosts | `ponytail-on-stimulants-mcp/` | Prompt/tool access to the canonical ruleset. |

Only Pi currently advertises forced completion passes. Other adapters inject the same stopping contract but do not claim a continuation hook their host does not safely expose.

## Canonical and generated sources

- `skills/ponytail-on-stimulants/SKILL.md` — full runtime behavior.
- `AGENTS.md` — compact static-rule source.
- `.cursor`, `.windsurf`, `.clinerules`, `.agents`, `.qoder`, `.github/copilot-instructions.md`, `.kiro` — checked copies of `AGENTS.md`.
- `.openclaw/skills/` — generated from `skills/` by `scripts/build-openclaw-skills.js`.
- `hooks/ponytail-on-stimulants-instructions.js` — shared mode filter/builder.

Validate copy integrity with `node scripts/check-rule-copies.js`.
