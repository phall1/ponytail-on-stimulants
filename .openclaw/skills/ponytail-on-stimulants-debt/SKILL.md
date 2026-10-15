---
name: ponytail-on-stimulants-debt
description: "Harvest deliberate ponytail-on-stimulants shortcut comments into a bounded debt ledger."
homepage: https://github.com/phall1/ponytail-on-stimulants
license: MIT
---

Every deliberate ponytail-on-stimulants shortcut is marked with a `ponytail-on-stimulants:` comment naming
its ceiling and upgrade path. This collects them into one ledger so a deferral
can't quietly become permanent.

## Scan

Scan tracked and non-ignored untracked files, honoring the repository's ignore rules:

```sh
git grep -nI --untracked --exclude-standard -E '(#|//|/\*|\*|<!--)[[:space:]]*ponytail-on-stimulants:' -- .
```

Exit 1 means no matches; other nonzero exits are scan errors, not a clean ledger.
Outside a Git repository, use `rg -n --hidden --glob '!.git'` with the same
pattern and explicit dependency/build exclusions. If neither tool is available,
report the scan limitation rather than recursively grepping ignored dependencies.

Include line and block comments. Inspect each hit: quoted examples and prose
about the convention are not debt. Each real marker is one ledger row.

## Output

One row per marker, grouped by file:

`<file>:<line>, <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.`

The convention is `ponytail-on-stimulants: <ceiling>, <upgrade path>`, so pull the ceiling
and the trigger straight from the comment. Want an owner per row too? add
`git blame -L<line>,<line>`.

Flag the rot risk: any `ponytail-on-stimulants:` comment that names no upgrade path or
trigger gets a `no-trigger` tag, those are the ones that silently rot.

End with `<N> markers, <M> with no trigger.` Nothing found: `No ponytail-on-stimulants: debt. Clean ledger.`

## Boundaries

Reads and reports only, changes nothing. To persist it, ask and it writes the
ledger to a file (e.g. `PONYTAIL-ON-STIMULANTS-DEBT.md`). One-shot.
