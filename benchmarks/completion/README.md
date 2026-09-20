# Completion benchmark

This fork-specific corpus measures whether higher agency closes tasks rather than merely producing more code.

## Arms

- **A — prompt only:** canonical completion-loop instructions.
- **B — deterministic:** prompt plus the deterministic gate in `feral` mode with Jev forcibly disabled.
- **C — deterministic + Jev:** the identical `feral` mode/pass policy with optional Jev evidence enabled.

`evaluate.js` runs the same pinned Pi provider/model against eight disposable Git fixtures under every arm, counterbalances arm order, preserves each raw workspace and JSONL transcript, and derives completed evidence keys from executable per-case oracles. B and C differ only in Jev enablement, so their delta is attributable to Jev rather than a different continuation budget. Failures carry explicit resolved/reported state; an investigated but still failing check remains incomplete. `score.js` calculates:

- task completion rate;
- premature-stop rate;
- caller coverage;
- verification depth;
- silent-failure rate;
- scope-creep rate;
- regression rate;
- cost and duration.

The corpus targets failure modes where a one-file diff looks plausible but is incomplete: shared callers, stale serialization, CLI parser/help/runtime/tests, API clients, migrations, generated output, sibling builds, and shared root causes.

## Scoring and offline instrument check

```sh
node benchmarks/completion/evaluate.js --selftest
node benchmarks/completion/selftest.js
PONYTAIL_ON_STIMULANTS_JEV_ENABLED=1 TYPESAFE_API_KEY=... \
  node benchmarks/completion/evaluate.js \
  --provider openai-codex --model gpt-5.6-sol --thinking high \
  --repetitions 3 --output benchmarks/completion/runs/gpt-5.6-sol.json
node benchmarks/completion/run.js benchmarks/completion/runs/gpt-5.6-sol.json scored.json
```

`evaluate.js --selftest` proves every seed is incomplete and every known solution passes its executable oracle without calling a model. A live run requires explicit Jev opt-in because all three arms are mandatory. Each run waits for Pi's single final `agent_settled` event; the extension queues completion passes before that event, so valid no-pass and early-stop outcomes are scored instead of timing out. Progress is written after every cell, and timeout/process failures become explicit incomplete run records rather than aborting the matrix. The scorer rejects unknown or unbalanced arm/case matrices, invalid schemas, and invalid cost/duration values; it emits repetition counts, dispersion, per-arm aggregates, and case records. The arithmetic self-test proves known-complete submissions pass and plausible “reported done after one file” submissions fail across all arms. Neither self-test makes a model-quality claim; only a preserved live matrix can do that.

## Live protocol

1. Pin Pi, provider, model, thinking level, fixture commit, and repetition count. The output records Pi version, source commit, and a SHA-256 of the fixture definitions.
2. Run the balanced, counterordered three-arm matrix in the generated isolated Git workspaces.
3. Let executable fixture oracles derive completion and regression labels; manually audit only semantic scope-creep/reporting labels.
4. Preserve raw workspaces/transcripts. For arm C, retain the sanitized Jev result embedded in the completion-pass transcript and stratify unavailable judgments rather than treating them as successful Jev runs.
5. Compare completion and premature-stop rates first. Treat cost/duration as secondary, and reject gains that increase scope creep or regressions.
6. Publish raw run metadata and variance; do not relabel inherited upstream benchmark reports as fork results.
