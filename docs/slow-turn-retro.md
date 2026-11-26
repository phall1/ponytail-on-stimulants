# Slow-turn retro

Claude Code and Codex install the Python 3.10+ stdlib-only Stop hook with the
plugin. Codex's user-hook fallback includes it; review it in `/hooks`.
`PONYTAIL_ON_STIMULANTS_SLOW_TURN_RETRO=0` disables the hook.

The hook measures from the latest human prompt and merges observable passive
spans before subtracting them. At 600 active seconds, a turn qualifies if a
non-file tool took at least 30 seconds or timer waits totalled 60 seconds.
A median model step of 45 seconds or more suppresses the retro. A live read
has a short deadline and fails open on oversized or unrecognized histories.

```sh
python3 -BS hooks/ponytail-on-stimulants-slow-turn-retro.py \
  --agent claude --dry-run /path/to/session.jsonl
python3 -BS hooks/ponytail-on-stimulants-slow-turn-retro.py \
  --agent codex --dry-run /path/to/rollout.jsonl
```

Replay ends at the recorded turn boundary and doesn't change hook state.
Claude uses recorded API requests and assistant events for model steps.
Codex uses the gap from the previous observable boundary to its next model
item: a latency proxy, not separately measured provider queue time. Wait and
approval coverage depends on events emitted by the host. A detected watcher
in a compound shell invocation classifies the invocation as passive; the
transcript does not provide per-subcommand durations.

Cursor's historical CLI JSONL omits timestamps and tool results. OpenCode V2
has a post-run event but does not identify interactive versus automated prompt
admission in its supported plugin hook. Neither runs this retro automatically.

The local log is
`${XDG_STATE_HOME:-~/.local/state}/ponytail-on-stimulants/slow-turn-retro.jsonl`.
It contains timings, tool names, event IDs and decisions. It does not contain
command lines, prompts or answers. `complete` entries record wall-clock
`retro_s`, with `rescued: true` if the hook asked once for the original answer
to be restored. The adjacent SQLite file keeps up to 400 fired-turn keys and
discards answer comparison hashes as each retro closes. The hook makes no
network requests.
