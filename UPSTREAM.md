# Upstream relationship

Canonical upstream: <https://github.com/DietrichGebert/ponytail>

Last reconciled version: `v4.10.0`

Last reconciled commit: `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`

Ponytail on Stimulants is a soft fork. Upstream is the authority for host protocol maintenance and installation plumbing; this fork is the authority for completion behavior, fork identity, Agent Plugins packaging, and its evaluation/gating code.

## Expected ownership

Mostly upstream-owned, reconciled rather than rewritten:

- host hook protocols and native adapter maintenance;
- installation plumbing and platform-specific fixes;
- packaging utilities that are not identity-specific;
- inherited correctness/safety benchmark machinery.

Intentionally fork-owned conflict surfaces:

- `AGENTS.md` and static rule copies;
- `skills/ponytail-on-stimulants*/` and generated `.openclaw/skills/` copies;
- `completion-gate/` and its Pi integration;
- `benchmarks/completion/`;
- fork package, plugin, command, skill, runtime-state, and branding identities;
- `README.md`, `UPSTREAM.md`, `RELEASE.md`;
- upstream-sync and fork release workflows.

Historical files under `benchmarks/results/` are upstream heritage. Keep their original claims and identify them as upstream evidence; do not silently relabel them as fork results.

## Reconciliation procedure

1. Ensure the worktree is clean.
2. `git fetch upstream main` and inspect upstream changelog/diff since the recorded commit.
3. Run `scripts/sync-upstream.sh --check` for a disposable-worktree conflict and structural check.
4. Create a temporary branch from current `main`; merge `upstream/main` with `--no-commit`.
5. Let upstream win for host protocol fixes. Reconcile behavioral and identity files consciously using the ownership list above; never accept upstream prompt semantics blindly.
6. Regenerate OpenClaw copies: `node scripts/build-openclaw-skills.js`.
7. Run `npm run check`, `npm test`, `npm run test:completion`, `python3 benchmarks/agentic/run.py --selftest`, and `python3 benchmarks/agentic/complete.py --selftest-offline`.
8. Update the version/commit at the top of this file and open a review PR. Do not auto-merge.

The scheduled `.github/workflows/upstream-sync.yml` follows the same policy on an automation branch. It opens a PR only after a conflict-free reconciliation and green validation. Conflicts create an issue and no branch is pushed to `main`.

## Known conflict classes

- upstream mode semantics vs the fork's `focused`/`full-send`/`feral` contract;
- upstream ladder-only prompt vs fork completion loop and stopping contract;
- globally named `ponytail` packages, skills, commands, files, and state vs coexistence-safe fork names;
- upstream code-size benchmark messaging vs fork completion metrics;
- Pi lifecycle handling, where this fork adds a bounded `agent_settled` continuation pass.

## Release relationship

A fork release records this upstream base, retains the MIT notice, uses only fork package/marketplace identities, and follows [RELEASE.md](RELEASE.md). Upstream tags and package versions do not become fork releases automatically.
