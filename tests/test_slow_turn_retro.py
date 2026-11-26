from contextlib import contextmanager
from datetime import datetime, timezone
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


HOOK = Path(__file__).resolve().parents[1] / "hooks" / "ponytail-on-stimulants-slow-turn-retro.py"
sys.path.insert(0, str(HOOK.parent))
spec = spec_from_loader("retro", SourceFileLoader("retro", str(HOOK)))
retro = module_from_spec(spec)
spec.loader.exec_module(retro)
from slow_turn_shell import shell_wait
from slow_turn_transcript import Turn, add_tool, read_turn


def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat()


@contextmanager
def transcript(rows):
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "session.jsonl"
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        yield path


class TimingTest(unittest.TestCase):
    def test_union_tool_time_and_file_exclusion(self):
        turn = Turn(start=10, interactive=True)
        add_tool(turn, "Bash", 100, 200, "gh run watch 123")
        add_tool(turn, "Bash", 150, 250, "tail --follow out")
        add_tool(turn, "AskUserQuestion", 220, 270)
        add_tool(turn, "Bash", 400, 465, "sleep 65")
        add_tool(turn, "Read", 500, 700)
        add_tool(turn, "Bash", 680, 720, "make test")
        add_tool(turn, "Test", 810, 839)
        add_tool(turn, "Test", 850, 870)
        add_tool(turn, "Test", 880, 899)
        turn.models = [(12, 19), (21, 31), (275, 300)]
        result = retro.measure(turn, 1010)
        self.assertEqual(result["watch_wait_s"], 150)
        self.assertEqual(result["user_wait_s"], 50)
        self.assertEqual(result["timer_wait_s"], 65)
        self.assertEqual(result["active_s"], 765)
        self.assertEqual(result["tool_s"], 288)
        self.assertEqual(result["thinking_s"], 477)
        self.assertEqual(result["tool_calls"], 9)
        self.assertEqual(result["max_tool_s"], 40)
        self.assertEqual(result["median_step_latency_s"], 10)
        self.assertEqual([tool["s"] for tool in result["slow_tools"]], [40, 29, 20])

    def test_skip_gates_and_exact_thresholds(self):
        turn = Turn(start=10, interactive=True)
        base = dict(active_s=600, max_tool_s=30, timer_wait_s=0, median_step_latency_s=44.9)
        for value, decision in [
            ({"active_s": 599.999}, "under_600s"),
            ({"max_tool_s": 29.999}, "thinking_only"),
            ({"max_tool_s": 0, "timer_wait_s": 60}, "fire"),
            ({"median_step_latency_s": 45}, "provider_latency"),
            ({}, "fire"),
        ]:
            with self.subTest(value=value):
                self.assertEqual(retro.gate(turn, base | value), decision)
        turn.interactive = False
        self.assertEqual(retro.gate(turn, base), "non_interactive")

    def test_raw_shell_position_and_quoting(self):
        for command in [
            'WORK=ok /usr/bin/gh run watch 123',
            'cd build && gh pr checks --watch --fail-fast',
            ['/bin/zsh', '-lc', 'echo setup\nkubectl logs deploy/app --follow'],
            'echo ' + 'x' * 1200 + '; tail -F run.log',
            "cat <<'TEXT'\ngh run watch 123\nTEXT\njournalctl --follow",
        ]:
            with self.subTest(command=command):
                self.assertEqual(shell_wait(command), "watch")
        for command in [
            'echo "gh run watch 123"',
            "printf '%s' ';' gh run watch 123",
            "cat <<-'TEXT'\n\tgh run watch 123\n\tTEXT\nmake test",
            'echo ok # gh run watch 123',
            "echo 'gh pr checks --watch\nsleep 100'",
            'gh pr checks --watch=false',
        ]:
            with self.subTest(command=command):
                self.assertIsNone(shell_wait(command))
        self.assertEqual(shell_wait("sleep 60"), "timer")


class TranscriptTest(unittest.TestCase):
    def test_claude_origin_requests_waits_and_nested_type(self):
        rows = [
            {"type": "user", "timestamp": iso(100), "origin": {"kind": "human"},
             "uuid": "user", "entrypoint": "cli"},
            {"type": "api-request", "id": "req", "timestamp": iso(102)},
            {"message": {"type": "message", "content": [{"type": "tool_use", "name": "Bash",
              "id": "tool", "input": {"command": "gh pr checks --watch"}}]},
             "type": "assistant", "requestRef": "req", "timestamp": iso(113)},
            {"type": "user", "timestamp": iso(180), "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tool"}]}},
            {"type": "attachment", "timestamp": iso(200), "attachment": {"type": "queued_command"}},
            {"type": "user", "timestamp": iso(201), "isMeta": True,
             "message": {"content": "<system-reminder>continue</system-reminder>"}},
            {"type": "assistant", "timestamp": iso(210)},
        ]
        with transcript(rows) as path:
            result = read_turn("claude", path)
        metrics = retro.measure(result, result.end)
        self.assertEqual(result.key, "user")
        self.assertEqual(metrics["median_step_latency_s"], 11)
        self.assertEqual(metrics["watch_wait_s"], 67)
        self.assertEqual(metrics["active_s"], 43)

    def test_codex_end_is_turn_completion_not_late_background_exit(self):
        def event(at, payload):
            return {"type": "event_msg", "timestamp": iso(at), "payload": {"turn_id": "t", **payload}}

        def item(start, end, kind, **data):
            return event(end, {"type": "item_completed", "started_at_ms": start * 1000,
                               "completed_at_ms": end * 1000, "item": {"type": kind, **data}})

        rows = [
            {"type": "session_meta", "payload": {"source": "vscode", "thread_source": "user"}},
            event(100, {"type": "task_started", "turn_attribution": {"turn_trigger": "user"}}),
            item(100, 100, "UserMessage", content=[{"text": "Run the tests."}]),
            item(110, 111, "Reasoning"),
            item(120, 300, "CommandExecution", command=["/bin/zsh", "-lc", "gh run watch 123"]),
            item(311, 312, "AgentMessage"),
            event(313, {"type": "task_complete"}),
            item(215, 1200, "CommandExecution", command=["sleep", "985"]),
        ]
        with transcript(rows) as path:
            result = read_turn("codex", path)
        metrics = retro.measure(result, result.end)
        self.assertTrue(result.interactive)
        self.assertEqual(metrics["watch_wait_s"], 180)
        self.assertEqual(metrics["timer_wait_s"], 0)
        self.assertEqual(metrics["active_s"], 33)

    def test_cli_dry_run_is_read_only(self):
        with transcript([{"type": "turn_ended", "status": "completed"}]) as path:
            process = subprocess.run(
                [sys.executable, "-BS", str(HOOK), "--agent", "cursor", "--dry-run", str(path)],
                check=True, capture_output=True, text=True,
                env={**os.environ, "XDG_STATE_HOME": str(path.parent / "state")},
            )
            self.assertEqual(json.loads(process.stdout)["decision"], "unsupported_or_no_user_turn")
            self.assertFalse((path.parent / "state").exists())


class StopTest(unittest.TestCase):
    def test_once_then_background_then_answer_rescue_then_complete(self):
        answer = "Fixed the default build path and verified all 24 tests with the regular command."
        data = {"session_id": "s", "hook_event_name": "Stop", "transcript_path": "unused",
                "last_assistant_message": answer}
        turn = Turn(key="t", start=100, interactive=True)
        add_tool(turn, "Bash", 200, 240, "make test")
        with (tempfile.TemporaryDirectory() as temp,
              patch.object(retro, "read_turn", return_value=turn),
              patch.dict(os.environ, {"CI": ""})):
            directory = Path(temp)
            response = retro.run_stop("claude", data, directory, 900)
            self.assertIn("800s active", response["reason"])
            data.update(stop_hook_active=True, background_tasks=[{"status": "running"}])
            turn.tools.clear()
            turn.models = [(801, 850)]
            self.assertEqual(retro.run_stop("claude", data, directory, 920), {})
            data.update(background_tasks=[], last_assistant_message="Speedup retro: optimized the cache.")
            self.assertIn("Answer rescue", retro.run_stop("claude", data, directory, 930)["reason"])
            self.assertEqual(retro.run_stop("claude", data, directory, 945), {})
            self.assertEqual(retro.run_stop("claude", data, directory, 960), {})
            rows = [json.loads(line) for line in (directory / "slow-turn-retro.jsonl").read_text().splitlines()]
            self.assertEqual([row["decision"] for row in rows], ["fire", "skip", "rescue", "complete", "skip"])
            self.assertEqual(rows[3]["retro_s"], 45)
            self.assertIs(rows[3]["rescued"], True)
            self.assertNotIn(answer, (directory / "slow-turn-retro.jsonl").read_text())

    def test_answer_with_footer_needs_no_rescue(self):
        answer = "The cache is in the default test runner. All ten checks passed."
        self.assertFalse(retro.missing_answer(retro.fingerprint(answer), answer + "\n\nSpeedup retro: 20s saved."))


if __name__ == "__main__":
    unittest.main()
