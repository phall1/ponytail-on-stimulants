# Harness compatibility review

Reviewed 2026-10-14/15 against upstream Ponytail **v5.2.0**, commit
`2961b52` (recorded merge base remains v4.10.0 / `e3ba2aa`). This is a
selective maintenance pass, not a wholesale upstream merge or a fork release.
The fork's modes, completion loop, bounded continuation caps and identity stay
fork-owned. Historical upstream benchmark results are not new fork results.

## Decisions and sources

- **OpenCode 2:** use the default `{ id, setup }` definition, skill/command
  transforms, session context and compaction hooks, prompt tracking, tool hooks,
  and canonical execution-success events. Failed/interrupted executions do not
  restart. V1 retains `server`, system transforms and best-effort idle prompts.
  No `session.stopping` API is assumed. Package-directory installs need the
  root `server.js` entry; `.opencode/plugins/index.js` supports auto-discovery.
  Sources: [V2 plugins](https://opencode.ai/v2/docs/plugins),
  [official Promise API](https://github.com/anomalyco/opencode/blob/2ae7ec8a16c3b73ce0df1197e20e09bc9148d19d/packages/plugin/src/README.md),
  [session hooks](https://github.com/anomalyco/opencode/blob/2ae7ec8a16c3b73ce0df1197e20e09bc9148d19d/packages/plugin/src/promise/session.ts),
  [execution events](https://github.com/anomalyco/opencode/blob/2ae7ec8a16c3b73ce0df1197e20e09bc9148d19d/packages/schema/src/session-event.ts).
- **Pi / OMP:** prefer Pi-owned prompt sections for cache-friendly deltas;
  preserve OMP's array of prompt parts. Restore branch mode and invalidate
  pending completion evidence on tree/switch/branch events. Keep the shared
  `agent_end` follow-up path for both hosts; never continue from notification-only
  `agent_settled`. Add argument completions, preserve active mode on bare command,
  clear disabled status, and tolerate uninitialized headless themes.
  Sources: [Pi extension API](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
  [OMP event types](https://github.com/can1357/oh-my-pi/blob/c2cb79e4c227aa4b22c4ccb933ff72fd88bceba4/packages/coding-agent/src/extensibility/extensions/types.ts).
- **Codex:** separate hook config from Claude because `PostToolUseFailure` is
  not a documented Codex event. Observed tool results without a reliable outcome
  stay `unknown`, not verified success. Restore mode on forked sessions; recognize
  namespaced `$ponytail-on-stimulants:ponytail-on-stimulants` invocations. Stop
  uses `decision: block` / `reason`; context injection does not emit warning-style
  `systemMessage`. Sources: [hooks](https://developers.openai.com/codex/hooks),
  [plugin packaging](https://developers.openai.com/plugins/build/plugins).
- **Portable manifest:** retain Agent Plugins 1.0 `$schema`. Unlike an older
  upstream workaround, current Codex documentation explicitly supports the
  `.codex-plugin/plugin.json` compatibility overlay when `extensions.com.openai`
  is absent. Ship that overlay in npm too; don't break portability to solve an
  obsolete discovery assumption. The schema fixtures remain unmodified.
- **Claude Code:** keep supported Stop `hookSpecificOutput.additionalContext`
  continuation, and keep its supported failure-event telemetry. Source:
  [Stop decision control](https://code.claude.com/docs/en/hooks#stop-decision-control).
- **Copilot CLI / VS Code:** ship native startup hooks in
  `com.github.copilot/hooks/hooks.json` for the canonical portable manifest.
  Its contents must match `hooks/copilot-hooks.json`. Config-file prompt-hook
  output is ignored, so don't claim immediate context reinjection or a stop gate.
  Sources: [plugin creation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating),
  [hook reference](https://docs.github.com/en/copilot/reference/hooks-reference).
- **Cursor:** `beforeSubmitPrompt` supports `continue` / `user_message`, not
  `additional_context`. Save selections for the next local sessionStart instead;
  persist off as a tombstone. Preserve malformed hook configurations and similarly
  named user hooks. Leave complex statusline shell expressions intact rather than
  corrupting quoting or semicolon semantics. Source: [hooks](https://cursor.com/docs/hooks).
- **Qoder:** use documented plugin-root/data markers, real SubagentStart hooks,
  resolved plugin-root launchers and `QODER_CONFIG_DIR`. Emit exactly one JSON
  object for report commands. Sources: [hooks](https://docs.qoder.com/cli/hooks),
  [plugin reference](https://docs.qoder.com/cli/plugins-reference).
- **Gemini / Qwen:** keep extension AGENTS.md, commands and skills; don't claim a
  native completion gate. Source: [extension reference](https://geminicli.com/docs/extensions/reference/).
- **Hermes:** existing registration APIs remain supported. Its pre-LLM injection
  augments user-turn context; module-global mode is shared across gateway chats.
  No stop veto is registered. Source: [pinned developer guide](https://github.com/NousResearch/hermes-agent/blob/5575a0859d6278bfcef79c28189a24594952efd3/website/docs/developer-guide/plugins/index.md).
- **Static rules:** add Windsurf's required `trigger: always_on` wrapper and
  check its canonical body. Keep Cursor/Kiro wrappers and Cline plain Markdown.
  Qoder users select Always Apply where required; `.agents/rules` is not a
  universal discovery standard. Sources: [Windsurf](https://docs.windsurf.com/windsurf/cascade/memories),
  [Cursor](https://cursor.com/docs/context/rules), [Kiro](https://kiro.dev/docs/steering/),
  [Cline](https://docs.cline.bot/customization/cline-rules), [Qoder](https://docs.qoder.com/user-guide/rules).
  Other inherited manifests remain skill-distribution adapters, not evidence of
  mutable mode or lifecycle enforcement.

## Useful upstream changes adopted

- OpenCode V2 port, command-argument preservation and attachment offset cleanup;
  compaction rules and skill frontmatter parsing.
- Pi/OMP prompt preservation, branch-mode restoration, autocomplete and status UX.
- Environment-read hook launchers (including fork-only gate hooks), Windows root
  normalization, synchronous stdout, referenced stdin deadlines and time-bounded
  subagent regex matching. Do not claim full Node 12 support from the launcher fix.
- Cursor configuration-shape preservation and narrow ownership; conservative
  statusline cleanup; Qoder state cleanup; silent off activation.
- Git-ignore-aware debt scanning including block comments; numbered review/audit
  findings and whole-tree caller evidence before deletion recommendations. Remove
  the unsafe example suggesting email validation can be replaced by an `@` test.
- Benchmark correctness error propagation, pandas-capable interpreter selection,
  preserved caller environment, isolated rule/memory inputs, crashed-cell summaries.

Not imported: upstream v5 prompt semantics, marketing/assets, optional SessionStart
repository maps, new benchmark populations/results or unrelated host expansion.
The agentic completeness judge's population/delivered-submission methodology
needs separate work before claiming new comparative completeness results; this
maintenance pass does not run or publish such an evaluation.

## Verification boundaries

Regression tests exercise real hook child processes, hostile checkout paths,
large piped output, stdin deadlines, pathological regexes, concurrent session cap
preservation, Codex unknown outcomes, Qoder JSON, Cursor safety, packed files,
OpenCode API-shaped callbacks, Pi/OMP lifecycle handling and benchmark failures.
Use the Development commands in README for the complete local gate.

Installed-host smoke checks use disposable configuration and no model requests:
OpenCode 2.0.29 loads the local package, activates the plugin and lists all six
commands and skills. API domains initialize asynchronously; an immediate empty
list is not a load failure. Record source/test validation separately from live
coding behavior. Pi 1.1.0 and OMP 18.10.3 both list all six extension commands from the
extracted npm package via RPC (`get_commands` / `get_available_commands`).
OMP requires a selected model at startup; a placeholder key was used only for
catalog selection, with no inference request. These checks cover the loader
boundaries without making paid requests. Real Pi rendering also verifies both
structured sections and an earlier extension's forced prompt. Regression tests
cover rejected delivery without disabling later OpenCode sessions and removal
of the generated Windows PowerShell statusline without rewriting complex shell
commands.

Research release identifiers (not tested minimums): Claude 2.1.300, Codex 0.162.1,
Copilot CLI 1.0.98, Gemini 0.64.0; fetched from official release metadata.
PowerShell, authenticated hook-trust flows and live model-driven sessions on
all hosts were not exercised. Native output support does not prove model
compliance. File-hook modes remain profile-shared; completion counters are
session-scoped. OpenCode mode is also profile-shared, and its continuation is
best-effort after the execution boundary, not an in-loop guarantee.

The **v0.4.3** maintenance pass revalidated the unchanged OpenCode adapter on
**2.0.32** (2026-10-17). With disposable HOME/XDG directories and an isolated
local service, the package loaded through `server.js`, reported active, and
listed all six fork commands and skills through the authenticated API. No
model request was made. The full regression suite and completion/agentic
self-tests remain separate evidence, not a claim of live coding compliance.

## Complexity evidence

Measured with lizard 1.24.1; unchanged pre-existing hotspots are not refactored.

| Touched function / seam | Before CCN | After CCN |
|---|---:|---:|
| OpenCode continuation coordinator (`maybeContinue`, removed) | 11 | replaced by smaller API-specific handlers |
| OpenCode V2 event consumer (review correction) | 10 | 8 (per-session isolation helper: 4) |
| Pi command parser | 9 | 8 (bare-command helper: 4) |
| Hook safety functions, maximum | 8 | 8 |
| Benchmark `aggregate` | 34 | 3 |
| Benchmark `run_cell` | 13 | 10 |

No new runtime dependency, provider service, configuration framework or plugin
abstraction was introduced.
