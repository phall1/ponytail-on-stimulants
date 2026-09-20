---
name: ponytail-on-stimulants-review
description: "Review a diff for unfinished execution and unjustified complexity, with concrete caller, verification, and scope findings."
homepage: https://github.com/phall1/ponytail-on-stimulants
license: MIT
---

Review the diff for the smallest sound architecture and complete execution. Check affected callers, sibling paths, edge cases, verification evidence, generated state, TODOs, and accidental files. Do not recommend unrelated cleanup.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for
multi-file diffs.

Tags:

- `incomplete:` directly required or mechanically implied work is missing.
- `verify:` changed behavior lacks proportionate execution evidence.
- `caller:` a consumer or sibling path still carries the old assumption.
- `bug:` the changed path is behaviorally wrong or fails a relevant edge case.
- `safety:` the change weakens security, accessibility, trust-boundary validation, or data-loss prevention.
- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Summary

End with `completion: complete|incomplete; net: -<N> lines possible.` If there are no findings, say `Lean and complete. Ship.`

## Boundaries

Review the requested change and its directly affected paths, not unrelated repository debt. Correctness, security, accessibility, trust-boundary validation, and data-loss prevention are in scope when the diff changes or omits them; never recommend simplifying those protections away. A focused runnable check is completion evidence, not bloat. This skill lists findings and does not apply fixes.

"stop ponytail-on-stimulants-review" or "normal mode": revert to normal review behavior.
