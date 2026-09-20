---
name: ponytail-on-stimulants-audit
description: >
  Whole-repo audit for incomplete execution and over-engineering. Like
  ponytail-on-stimulants-review, but scans the entire codebase: a ranked list of
  broken sibling paths, stale generated state, verification gaps, and unjustified complexity. Use when the user says "audit this
  codebase", "audit for over-engineering", "what can I delete from this repo",
  "find bloat", "ponytail-on-stimulants-audit", or "/ponytail-on-stimulants-audit". One-shot report, does
  not apply fixes.
---

Ponytail on Stimulants review, repo-wide. Scan the whole tree instead of a diff. Rank correctness/completion blockers first, then the biggest justified simplifications.

## Tags

Same as ponytail-on-stimulants-review:

- `incomplete:` requested or mechanically implied work is missing.
- `verify:` important behavior has no execution evidence.
- `caller:` a sibling path still carries the old assumption.
- `bug:` a shared or sibling path is behaviorally wrong.
- `safety:` security, accessibility, trust-boundary validation, or data-loss prevention is weakened.
- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Hunt

Deps the stdlib or platform already ships, single-implementation interfaces,
factories with one product, wrappers that only delegate, files exporting one
thing, dead flags and config, hand-rolled stdlib.

## Output

One line per finding, ranked: `<tag> <finding>. <replacement or required action>. [path]`.
End with `completion blockers: <N>; net: -<L> lines, -<D> deps possible.` No findings: `Lean and complete. Ship.`

## Boundaries

Audit the repository for system-level patterns without inventing a redesign or treating unrelated style preferences as findings. Correctness and safety are in scope; never recommend removing necessary validation, data-loss prevention, security, or accessibility behavior. Lists findings, applies nothing. One-shot.

"stop ponytail-on-stimulants-audit" or "normal mode" to revert.
