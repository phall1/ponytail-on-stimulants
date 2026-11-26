#!/usr/bin/env python3
"""Measure slow interactive turns and request at most one bounded retro."""

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import statistics
import sys
import time

from slow_turn_transcript import FILE_TOOLS, Turn, read_turn


MARKER = "slow-turn-retro:"
RETRO = """\
Diagnose the bottleneck. Fix a recurring, meaningful bottleneck directly in the default path:
use an existing code path, CLI default, config, cache, parallel runner, targeted check, shared helper,
or a fast PreToolUse guard for confirmed recurring hangs. Skip one-off work, finished migrations,
superseded experiments and irreducible external waits. Preserve accuracy, verification and scope;
ask before taking costly, outward-facing or risky actions.

Budget 2–3 minutes for a local fix. Only shared cross-project tooling merits longer. If a fix
hangs, fails unexpectedly or causes cascading breakage and isn't green within about three minutes,
revert only your retro changes and finish. Verify any speedup, record a reusable finding in the
project's durable notes, and report measured savings if available. If nothing can safely be sped
up, say so in one sentence.

Start your final message with the complete answer to the user's original request, preserving its
substantive details even if already shown. Append a brief `Speedup retro:` note at the bottom."""
RESCUE = (
    f"{MARKER} Answer rescue. Do not run any more tools or repeat the retro. Restate your complete "
    "answer from before the retro, including its results, evidence and links; then append the "
    "brief `Speedup retro:` note. The earlier answer may be hidden in the UI."
)


def merge(spans):
    merged = []
    for start, end in sorted(spans):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            previous, stop = merged[-1]
            merged[-1] = (previous, max(end, stop))
        else:
            merged.append((start, end))
    return merged


def seconds(spans):
    return sum(end - start for start, end in spans)


def overlap(span, merged):
    start, end = span
    return sum(max(0, min(end, stop) - max(start, begin)) for begin, stop in merged)


def tool_metrics(turn, clip, passive):
    tools, slow = [], []
    for name, start, end, kind in turn.tools:
        if kind:
            continue
        span = clip(start, end)
        duration = span[1] - span[0] - overlap(span, passive)
        tools.append(span)
        if name.lower() not in FILE_TOOLS and duration > 0:
            slow.append((duration, name))
    tools = merge(tools)
    tool_time = seconds(tools) - sum(overlap(span, passive) for span in tools)
    slow.sort(reverse=True)
    return tool_time, slow


def model_median(turn, clip, passive):
    samples = [b - a - overlap((a, b), passive) for a, b in map(lambda s: clip(*s), turn.models)]
    samples = [value for value in samples if value > 0]
    return round(statistics.median(samples), 3) if samples else None


def measure(turn, now):
    def clip(start, end):
        return max(start, turn.start), min(end, now)

    waits = {kind: merge(clip(a, b) for k, a, b in turn.waits if k == kind)
             for kind in ("user", "timer", "idle", "watch")}
    passive = merge(span for spans in waits.values() for span in spans)
    wall = max(0, now - turn.start) if turn.start else 0
    active = max(0, wall - seconds(passive))
    tool_time, slow = tool_metrics(turn, clip, passive)
    return {
        "active_s": round(active, 3),
        "user_wait_s": round(seconds(waits["user"]), 3),
        "timer_wait_s": round(seconds(waits["timer"]), 3),
        "watch_wait_s": round(seconds(waits["watch"]), 3),
        "idle_wait_s": round(seconds(waits["idle"]), 3),
        "passive_s": round(seconds(passive), 3),
        "tool_s": round(tool_time, 3),
        "thinking_s": round(max(0, active - tool_time), 3),
        "max_tool_s": round(slow[0][0], 3) if slow else 0,
        "tool_calls": len(turn.tools),
        "median_step_latency_s": model_median(turn, clip, passive),
        "slow_tools": [{"tool": name, "s": round(duration, 3)}
                       for duration, name in slow[:3] if duration >= 15],
    }


def gate(turn, metrics):
    if not turn.interactive:
        return "non_interactive"
    if metrics["active_s"] < 600:
        return "under_600s"
    if metrics["max_tool_s"] < 30 and metrics["timer_wait_s"] < 60:
        return "thinking_only"
    if (metrics["median_step_latency_s"] or 0) >= 45:
        return "provider_latency"
    return "fire"


def fingerprint(text):
    # Store only hashed word shingles, not the answer or transcript in state.
    words = re.findall(r"\w+", text[:64_000].casefold())[:2500]
    width = min(3, len(words))
    if not width:
        return {}
    return dict(Counter(
        hashlib.blake2b(" ".join(words[i:i + width]).encode(), digest_size=8).hexdigest()
        for i in range(len(words) - width + 1)
    ))


def missing_answer(previous, answer):
    if not previous:
        return False
    current = fingerprint(re.split(r"\bspeedup retro:", answer, maxsplit=1, flags=re.I)[0])
    covered = sum((Counter(previous) & Counter(current)).values())
    return covered / sum(previous.values()) < 0.55


def reason(metrics):
    slow = ", ".join(f"{tool['tool']} {tool['s']:g}s" for tool in metrics["slow_tools"]) or "none"
    return (
        f"{MARKER} {metrics['active_s']:g}s active: {metrics['tool_s']:g}s in "
        f"{metrics['tool_calls']} tool calls, {metrics['thinking_s']:g}s model/overhead; "
        f"{metrics['passive_s']:g}s passive. Slow tools (≥15s): {slow}.\n\n{RETRO}"
    )


def state_directory():
    base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local/state")
    return base / "ponytail-on-stimulants"


def append_log(directory, record):
    path = directory / "slow-turn-retro.jsonl"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as output:
        output.write(json.dumps(record, separators=(",", ":")) + "\n")


def lookup(db, session, key, continuation):
    entry = db.execute(
        "SELECT * FROM turns WHERE session=? AND turn=?", (session, key)
    ).fetchone()
    if entry is None and continuation:
        return db.execute(
            "SELECT * FROM turns WHERE session=? AND finished=0 ORDER BY rowid DESC LIMIT 1",
            (session,),
        ).fetchone()
    return entry


def close_retro(db, entry, now, answer, background):
    if entry["finished"]:
        return "skip", "already_complete", {}, ""
    if background:
        return "skip", "background_tasks", {}, ""
    identity = (entry["session"], entry["turn"])
    if not entry["rescued"] and missing_answer(json.loads(entry["answer"]), answer):
        db.execute("UPDATE turns SET rescued=1 WHERE session=? AND turn=?", identity)
        return "rescue", "answer_overlap", {}, RESCUE
    db.execute("UPDATE turns SET finished=1, answer='{}' WHERE session=? AND turn=?", identity)
    details = {"retro_s": round(max(0, now - entry["fired"]), 3)}
    if entry["rescued"]:
        details["rescued"] = True
    return "complete", "finished", details, ""


def settle(db, session, turn, metrics, data, now):
    continuation = data.get("stop_hook_active", False)
    entry = lookup(db, session, turn.key, continuation)
    answer = data.get("last_assistant_message") or ""
    background = data.get("background_tasks")
    if entry:
        return close_retro(db, entry, now, answer, background)
    if background:
        return "skip", "background_tasks", {}, ""
    verdict = gate(turn, metrics)
    if verdict != "fire":
        return "skip", verdict, {}, ""
    if continuation:
        return "skip", "other_stop_hook_active", {}, ""
    db.execute(
        "INSERT INTO turns(session, turn, fired, answer) VALUES(?,?,?,?)",
        (session, turn.key, now, json.dumps(fingerprint(answer))),
    )
    db.execute("DELETE FROM turns WHERE rowid IN (SELECT rowid FROM turns ORDER BY rowid DESC LIMIT -1 OFFSET 400)")
    return "fire", "slow_turn", {}, reason(metrics)


def run_stop(agent, data, directory, now):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    event = data.get("hook_event_name")
    excluded = data.get("agent_id") or data.get("agent_type") or event != "Stop" or os.environ.get("CI")
    transcript = data.get("transcript_path")
    turn = Turn(key=data.get("turn_id") or "")
    if transcript and not excluded:
        turn = read_turn(agent, transcript, turn.key)
    if agent == "claude" and data.get("prompt_id") not in {None, turn.key}:
        # A background wake may still have an older human turn in the transcript.
        turn.interactive = False
    metrics = measure(turn, now)
    raw_session = data.get("session_id") or ""
    session = f"{agent}:{raw_session}"
    with sqlite3.connect(directory / "slow-turn-retro.sqlite", timeout=0) as db:
        db.row_factory = sqlite3.Row
        db.execute("""CREATE TABLE IF NOT EXISTS turns (
            session TEXT, turn TEXT, fired REAL, answer TEXT, rescued INTEGER DEFAULT 0,
            finished INTEGER DEFAULT 0, UNIQUE(session,turn))""")
        db.execute("BEGIN IMMEDIATE")
        if excluded or not raw_session:
            decision, why, details, prompt = "skip", "non_interactive", {}, ""
        else:
            decision, why, details, prompt = settle(db, session, turn, metrics, data, now)
        append_log(directory, {
            "at": now, "agent": agent, "session": raw_session, "turn": turn.key,
            "decision": decision, "reason": why, **metrics, **details,
        })
    return {"decision": "block", "reason": prompt} if prompt else {}


def deadline(_signum, _frame):
    raise TimeoutError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", required=True, choices=("claude", "codex", "cursor", "opencode"))
    parser.add_argument("--dry-run", type=Path, metavar="TRANSCRIPT")
    args = parser.parse_args()
    if args.dry_run:
        turn = read_turn(args.agent, args.dry_run)
        metrics = measure(turn, turn.end)
        verdict = gate(turn, metrics) if turn.key else "unsupported_or_no_user_turn"
        print(json.dumps({**metrics, "decision": verdict}))
        return
    if os.environ.get("PONYTAIL_ON_STIMULANTS_SLOW_TURN_RETRO") == "0":
        return
    directory = state_directory()
    try:
        if hasattr(signal, "setitimer"):
            signal.signal(signal.SIGALRM, deadline)
            signal.setitimer(signal.ITIMER_REAL, 0.065)
        response = run_stop(args.agent, json.load(sys.stdin), directory, time.time())
        if response:
            print(json.dumps(response))
    except Exception as error:
        # Never leak transcript contents or interfere with the harness on errors.
        try:
            append_log(directory, {"at": time.time(), "agent": args.agent, "decision": "skip",
                                   "reason": "hook_error", "error": type(error).__name__})
        except OSError:
            pass


if __name__ == "__main__":
    main()
