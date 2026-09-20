---
name: ponytail-on-stimulants-gain
description: "Show inherited upstream benchmark evidence separately from fork completion metrics."
homepage: https://github.com/phall1/ponytail-on-stimulants
license: MIT
---

# Ponytail on Stimulants Measurement

One-shot report; do not change mode or state.

Report two distinct evidence sets:

1. **Upstream heritage.** The dated reports under `benchmarks/results/` were produced by upstream Ponytail and measure code size, safety, cost, and duration. They are retained for attribution and regression context; do not present them as fork results.
2. **Fork completion evaluation.** `benchmarks/completion/` measures task completion, premature stops, caller coverage, verification depth, silent failures, scope creep, regressions, cost, and duration across prompt-only, deterministic-gate, and deterministic-plus-Jev arms.

If no live fork matrix has been run, say so plainly and provide the offline self-test command:

```sh
node benchmarks/completion/selftest.js
```

Never invent a per-repository savings or completion number.
