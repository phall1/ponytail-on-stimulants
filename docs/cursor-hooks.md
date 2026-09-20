# Cursor hooks

Cursor can run Ponytail on Stimulants through native hooks or a static rule. These are alternatives, not layers to combine.

## Install

```sh
git clone https://github.com/phall1/ponytail-on-stimulants
node ponytail-on-stimulants/scripts/cursor-hooks.js install
node ponytail-on-stimulants/scripts/cursor-hooks.js install --project
```

Uninstall with the same script and `uninstall`; add `--project` for project scope. The installer merges only entries that run `ponytail-on-stimulants-*.js`, preserves unrelated hooks, and uses the `PONYTAIL_ON_STIMULANTS_DIR` template placeholder. State is stored at `~/.cursor/.ponytail-on-stimulants-active`, separate from upstream Ponytail.

## Events

- `sessionStart` runs `hooks/ponytail-on-stimulants-activate.js`, writes the default mode, and injects the canonical rules through `additional_context`.
- `beforeSubmitPrompt` runs `hooks/ponytail-on-stimulants-mode-tracker.js`, handles `/ponytail-on-stimulants focused|full-send|feral|off`, and injects the newly selected mode.

Cursor's `continue: true` means “allow this prompt submission”; it is not a stop lifecycle. Cursor therefore receives the behavioral stopping contract but does not run Pi's forced completion passes.

## Static-rule coexistence

If `<workspace>/.cursor/rules/ponytail-on-stimulants.mdc` exists, the rules are already always-on and cannot be switched off by a hook. The hooks detect it, avoid duplicate/contradictory injection, and return a notice for mode commands. Delete the rule if you want hook-managed modes.

The fork uses a different rule filename, state file, hook filename pattern, and installer ownership test from upstream Ponytail, so installing or uninstalling one does not claim the other's state.

## Limits

- Cursor cloud agents do not fire local `sessionStart` hooks.
- Cursor's `subagentStart` contract cannot inject arbitrary context, so native subagents do not inherit the fork rules through this adapter.
- The first workspace root is used for static-rule detection in multi-root workspaces.
- Hook failures are fail-open and never block prompt submission.

## Verification

Run `node --test tests/cursor-hooks.test.js`. For a live check, start a new local Agent chat, ask it to quote the first injected line, switch to `feral`, and verify it reports `PONYTAIL ON STIMULANTS MODE CHANGED — mode: feral`. Then switch `off` and confirm the fork state file is removed.
