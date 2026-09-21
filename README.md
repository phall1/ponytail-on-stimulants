# Ponytail on Stimulants

> **Minimal architecture. Maximal execution.**

Ponytail taught coding agents to stop over-engineering. Ponytail on Stimulants teaches them to stop under-executing.

Same senior engineer. Now the ticket is actually getting closed.

This project is a maintainable soft fork of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail). It is packaged as an [Agent Plugins v1.0.0](https://agent-plugins.org/specification) plugin and keeps Ponytail's YAGNI, reuse, standard-library, native-platform, portability, and safety discipline while adding an operational completion contract:

1. understand the repository and affected flow;
2. choose the smallest sound architecture;
3. execute the whole requested and mechanically implied change;
4. verify in proportion to blast radius;
5. run an adversarial second pass before stopping.

**Unbounded persistence. Bounded scope.** Finish what the outcome requires; do not turn persistence into unrelated refactoring.

## Modes

| Mode | Behavior |
|------|----------|
| `focused` | Complete the requested path with normal proportional verification. |
| `full-send` | Trace affected paths, do implied work, verify, and run an explicit adversarial pass. Default. |
| `feral` | Stronger caller/edge search and broader reasonable verification; scope remains bounded. |
| `off` | Disable injected behavior in native adapters. |

## Operational completion gate

The Pi adapter demonstrates the stronger loop end to end. After a qualifying coding turn settles, it gathers deterministic evidence (mutations, tool errors, repeated actions/failures, `git diff --check`, changed files, and introduced TODO markers) and can queue a bounded completion pass:

- `focused`: 0 forced passes
- `full-send`: 1 forced pass
- `feral`: at most 2 forced passes

Human input resets the counter; extension follow-ups do not. Hard caps, the off state, and fail-open error handling prevent infinite agency. Other hosts still receive the complete prompt contract; they do not pretend to support a continuation lifecycle they lack.

### Experimental Jev judge

Jev is optional and is never the coding model. On feral's second stop attempt, Pi can send compact structured state to TypeSafe's System One API. Code calculates deterministic facts; Jev judges fuzzy completion questions; the coding agent reasons and executes.

```sh
export PONYTAIL_ON_STIMULANTS_JEV_ENABLED=1
export TYPESAFE_API_KEY=...
```

Optional settings:

- `PONYTAIL_ON_STIMULANTS_JEV_MODEL` (default `jev-latest`)
- `PONYTAIL_ON_STIMULANTS_JEV_TIMEOUT_MS` (default `2500`)
- `PONYTAIL_ON_STIMULANTS_JEV_RETRIES` (`0` or `1`, default `0`)
- `PONYTAIL_ON_STIMULANTS_JEV_ENDPOINT` (default official endpoint)

Missing credentials, timeout, transport errors, service errors, and malformed responses fail open. Jev is advisory: its judgment is shown to the coding model and never starts or suppresses execution directly. When enabled, the adapter sends only request/response length and claim flags, changed paths, tool-result fingerprints, and aggregate evidence to TypeSafe. It does not send task text, assistant-response text, file contents, tool output, or raw command text. Changed paths and fingerprints can still be sensitive metadata, so leave Jev disabled when repository metadata must not leave the machine. Core behavior has no TypeSafe dependency.

## Install

### Agent Plugins v1.0.0

Install this repository or its npm artifact with an Agent Plugins v1.0.0 client. The portable package uses the fixed layout:

- `plugin.json` — canonical closed manifest;
- `skills/*/SKILL.md` — discoverable Agent Skills;
- `mcp.json` — stdio server declaration;
- `mcp/server.js` — dependency-free Node server exposing the `ponytail-on-stimulants` prompt and `ponytail_on_stimulants_instructions` tool.

The MCP server runs directly from an extracted package and requires no package-local dependency installation. It accepts only `focused`, `full-send`, and `feral`.

The sections below cover current native adapters for client behavior outside the portable Agent Plugins core.

### Pi

```sh
pi install git:github.com/phall1/ponytail-on-stimulants
```

### OpenCode

```json
{ "plugin": ["ponytail-on-stimulants"] }
```

From a checkout:

```json
{ "plugin": ["./.opencode/plugins/ponytail-on-stimulants.mjs"] }
```

### Claude Code

Send these as two separate prompts:

```text
/plugin marketplace add phall1/ponytail-on-stimulants
/plugin install ponytail-on-stimulants@ponytail-on-stimulants
```

### Codex

```sh
codex plugin marketplace add phall1/ponytail-on-stimulants
codex plugin add ponytail-on-stimulants@ponytail-on-stimulants
```

Then open `/hooks`, review and trust the lifecycle hooks, and start a new thread.

### GitHub Copilot CLI

```sh
copilot plugin marketplace add phall1/ponytail-on-stimulants
copilot plugin install ponytail-on-stimulants@ponytail-on-stimulants
```

The equivalent interactive commands are the two `/plugin` commands shown for Claude Code.

### Gemini CLI

```sh
gemini extensions install https://github.com/phall1/ponytail-on-stimulants
```

### Hermes Agent

```sh
hermes plugins install phall1/ponytail-on-stimulants --enable
```

### Cursor hooks

```sh
git clone https://github.com/phall1/ponytail-on-stimulants
node ponytail-on-stimulants/scripts/cursor-hooks.js install
```

Static-rule hosts can copy the uniquely named rule from `.cursor/rules/`, `.windsurf/rules/`, `.clinerules/`, `.agents/rules/`, `.qoder/rules/`, `.kiro/steering/`, or `.github/copilot-instructions.md`.

### Uninstall and state cleanup

Use each host's normal plugin/package removal command, then run `node scripts/uninstall.js` from an npm install or checkout to remove fork-owned user state. For a project-scoped Cursor hook installation, run `node scripts/cursor-hooks.js uninstall --project` from that project. These scripts match only `ponytail-on-stimulants` files and leave upstream Ponytail and unrelated hooks untouched.

## Commands and configuration

```text
/ponytail-on-stimulants [focused|full-send|feral|off]
/ponytail-on-stimulants default <mode>
/ponytail-on-stimulants status
/ponytail-on-stimulants-review
/ponytail-on-stimulants-audit
/ponytail-on-stimulants-debt
/ponytail-on-stimulants-gain
/ponytail-on-stimulants-help
```

Default-mode resolution:

1. `PONYTAIL_ON_STIMULANTS_DEFAULT_MODE`
2. `~/.config/ponytail-on-stimulants/config.json` (or XDG/Windows equivalent)
3. `full-send`

Runtime flags and config paths are distinct from upstream Ponytail, so both can be installed together. Commands, skills, plugin IDs, rule filenames, hook filenames, status keys, MCP identity, and uninstall matching are also fork-specific.

Pi persists mode per session. File-hook native adapters preserve a selected mode across resume/compact events but share one fork-specific mode file per host profile; a fresh startup resets it to the configured default. Concurrent conversations in those hosts can therefore observe the most recent mode switch. This is an adapter limitation, not a claim of per-session isolation.

## Development

```sh
node scripts/build-openclaw-skills.js
npm run check
npm test
npm run test:completion
python3 benchmarks/agentic/run.py --selftest
python3 benchmarks/agentic/complete.py --selftest-offline
```

`npm test` inherits one upstream pandas-backed correctness check; install pandas in your environment or an isolated virtualenv for the CI-equivalent run.

See [UPSTREAM.md](UPSTREAM.md) for ownership and sync policy, [RELEASE.md](RELEASE.md) for the release checklist, and [benchmarks/completion/](benchmarks/completion/) for fork-specific completion evaluation.

## Attribution

Ponytail on Stimulants is derived from [Ponytail](https://github.com/DietrichGebert/ponytail), created by Dietrich Gebert, and retains the upstream MIT license and copyright notice. Fork-specific branding and behavior are maintained by [phall1](https://github.com/phall1).
