"""Read only the latest turn from the Claude Code and Codex rollout formats."""

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import json
import re

from slow_turn_shell import shell_wait


RECORD_TYPE = re.compile(rb'"type"\s*:\s*"([^"]+)"')
CLAUDE_TYPES = {b"user", b"assistant", b"system", b"api-request", b"attachment"}
CODEX_TYPES = {b"event_msg", b"response_item"}
CODEX_CALL = re.compile(rb'"type"\s*:\s*"(?:custom_tool_call|function_call)"')
CHUNK = 64 * 1024
FILE_TOOLS = {"read", "edit", "write", "multiedit", "notebookedit", "apply_patch", "filechange"}
USER_TOOLS = {"askuserquestion", "request_user_input", "question", "exitplanmode"}
IDLE_TOOLS = {"wait", "yield", "wait_agent", "wait_for_agent", "taskoutput", "agent_wait", "party_wait"}
SHELL_TOOLS = {"bash", "shell", "exec_command", "commandexecution"}


@dataclass
class Turn:
    key: str = ""
    start: float = 0
    end: float = 0
    interactive: bool = False
    tools: list = field(default_factory=list)
    waits: list = field(default_factory=list)
    models: list = field(default_factory=list)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def reverse_lines(stream):
    offset = stream.seek(0, 2)
    fragments = []
    while offset:
        length = min(CHUNK, offset)
        offset -= length
        stream.seek(offset)
        head, *lines = stream.read(length).split(b"\n")
        if lines:
            yield b"".join([lines.pop(), *reversed(fragments)])
            yield from reversed(lines)
            fragments.clear()
        fragments.append(head)
    yield b"".join(reversed(fragments))


def recent_records(stream, types):
    for line in reverse_lines(stream):
        match = RECORD_TYPE.search(line)
        # Claude's assistant and attachment rows can have a nested type before
        # the record's type. Only use the fast path on known top-level prefixes.
        flat_prefix = line.startswith((b'{"type"', b'{"timestamp"'))
        if not match or (flat_prefix and match[1] not in types):
            continue
        if match[1] == b"response_item" and not CODEX_CALL.search(line[:250]):
            continue
        try:
            record = json.loads(line)
            if record.get("type", "").encode() in types:
                yield record
        except ValueError:  # A writer can be partway through the last line.
            continue


def wait_kind(name, command=""):
    short = re.split(r"__|:", name.lower())[-1]
    if short in USER_TOOLS:
        return "user"
    if short in IDLE_TOOLS or short in {"agent", "task"}:
        return "idle"
    if short in {"sleep", "timer", "schedulewake"}:
        return "timer"
    if short in SHELL_TOOLS:
        return shell_wait(command)
    return None


def add_tool(turn, name, start, end, command="", kind=None):
    kind = kind or wait_kind(name, command)
    if kind:
        turn.waits.append((kind, start, end))
    turn.tools.append((name, start, end, kind))


def claude_prompt(record):
    return (
        record.get("type") == "user"
        and not record.get("isMeta")
        and not record.get("isSidechain")
        and (record.get("origin") or {}).get("kind") == "human"
        and not str(record.get("message", {}).get("content", "")).startswith("slow-turn-retro:")
    )


def claude_turn(stream):
    rows = []
    for record in recent_records(stream, CLAUDE_TYPES):
        if record.get("isSidechain") or not record.get("timestamp"):
            continue
        rows.append(record)
        if claude_prompt(record):
            break
    if not rows or not claude_prompt(rows[-1]):
        return Turn()
    prompt = rows.pop()
    last = rows[0] if rows else prompt
    turn = Turn(
        key=prompt.get("turnPromptId") or prompt["uuid"],
        start=timestamp(prompt["timestamp"]),
        end=timestamp(last["timestamp"]),
        interactive=prompt.get("entrypoint") in {"cli", "claude-desktop", "vscode"},
    )
    ClaudeEvents(turn).read(reversed(rows))
    return turn


class ClaudeEvents:
    def __init__(self, turn):
        self.turn = turn
        self.calls = {}
        self.requests = {}
        self.idle_start = None
        self.approvals = {}

    def read(self, rows):
        handlers = {
            "assistant": self.assistant, "user": self.result, "attachment": self.attachment,
            "api-request": self.request, "system": self.system,
        }
        for row in rows:
            handlers[row["type"]](row, timestamp(row["timestamp"]))

    def request(self, row, at):
        self.requests[row["id"]] = at
        if self.idle_start is not None:
            self.turn.waits.append(("idle", self.idle_start, at))
            self.idle_start = None

    def assistant(self, row, at):
        requested = self.requests.pop(row.get("requestRef"), None)
        if requested is not None:
            self.turn.models.append((requested, at))
        for block in blocks(row):
            if block.get("type") == "tool_use":
                self.calls[block["id"]] = (block["name"], at, block.get("input") or {})

    def result(self, row, at):
        for block in blocks(row):
            call_id = block.get("tool_use_id")
            call = self.calls.pop(call_id, None)
            if block.get("type") == "tool_result" and call:
                name, start, args = call
                approval = self.approvals.pop(call_id, None)
                if approval is not None:
                    self.turn.waits.append(("user", approval, at))
                add_tool(self.turn, name, start, at, args.get("command", ""))

    def attachment(self, row, at):
        attachment = row["attachment"]
        if attachment.get("type") == "queued_command" and self.idle_start is not None:
            self.turn.waits.append(("idle", self.idle_start, at))
            self.idle_start = None

    def system(self, row, at):
        if row.get("subtype") == "turn_duration":
            self.idle_start = at
        if row.get("subtype") == "permission_prompt" and row.get("toolUseID"):
            self.approvals[row["toolUseID"]] = at


def blocks(row):
    content = row.get("message", {}).get("content")
    return content if isinstance(content, list) else ()


def codex_meta(stream):
    stream.seek(0)
    first = json.loads(stream.readline())
    return first["payload"] if first.get("type") == "session_meta" else {}


def codex_turn(stream, requested_turn=""):
    meta = codex_meta(stream)
    rows = []
    for row in recent_records(stream, CODEX_TYPES):
        event = row.get("payload", {})
        associated = event.get("turn_id")
        if requested_turn and associated and associated != requested_turn:
            continue
        if event.get("type") == "task_started":
            return codex_events(meta, row, reversed(rows))
        if event.get("type") in {"item_completed", "task_complete", "turn_aborted", "user_message",
                                 "exec_approval_request", "apply_patch_approval_request",
                                 "custom_tool_call", "function_call"}:
            rows.append(row)
    return Turn()


def interactive_codex(meta, attribution):
    root_user = meta.get("thread_source") in (None, "user") and not attribution.get("parent_turn_id")
    interactive_source = meta.get("source") in ("cli", "vscode") or meta.get("source") == {"custom": "app-server"}
    return root_user and interactive_source and attribution.get("turn_trigger", "user") == "user"


def codex_events(meta, start_row, rows):
    event = start_row["payload"]
    turn = Turn(key=event["turn_id"], end=timestamp(start_row["timestamp"]))
    interactive = interactive_codex(meta, event.get("turn_attribution") or {})
    pending_approvals = {}
    cursor = turn.end
    last_call = cursor
    for row in rows:
        payload = row["payload"]
        if payload.get("turn_id", turn.key) not in {None, turn.key}:
            continue
        at = timestamp(row["timestamp"])
        turn.end = max(turn.end, at)
        if payload["type"] == "item_completed":
            cursor = codex_item(turn, payload, cursor, last_call, pending_approvals)
        elif payload["type"] in {"custom_tool_call", "function_call"}:
            last_call = at
        elif payload["type"] in {"exec_approval_request", "apply_patch_approval_request"}:
            pending_approvals[payload.get("call_id")] = at
        elif payload["type"] == "user_message" and not turn.start:
            turn.start = at
        elif payload["type"] in {"task_complete", "turn_aborted"}:
            interactive = interactive and payload["type"] == "task_complete"
            break
    turn.interactive = bool(turn.start and interactive)
    return turn


def codex_item(turn, payload, cursor, last_call, approvals):
    item = payload["item"]
    name = item["type"]
    start = (payload.get("started_at_ms") or payload["completed_at_ms"]) / 1000
    end = payload["completed_at_ms"] / 1000
    if name == "UserMessage":
        if any(str(part.get("text", "")).startswith("slow-turn-retro:") for part in item.get("content", [])):
            return cursor
        turn.start = start
        return end
    if name in {"AgentMessage", "Reasoning"}:
        # Older rollouts lack model request timestamps; only measure the
        # interval to the first emitted model item after input/tool output.
        if start - cursor >= 0.5:
            turn.models.append((cursor, start))
        return max(cursor, end)
    if name not in {"CommandExecution", "McpToolCall", "FileChange", "Extension",
                    "WebSearch", "ImageView", "DynamicToolCall"}:
        return cursor
    call_id = item.get("id")
    if call_id in approvals:
        turn.waits.append(("user", approvals.pop(call_id), start))
    if name in {"McpToolCall", "DynamicToolCall"}:
        name = item.get("tool", name)
    if name == "CommandExecution":
        # A detached command can finish much later during a poll. The
        # foreground call is the earliest point this item can have blocked.
        start = max(start, min(last_call, end))
    add_tool(turn, name, start, end, item.get("command", ""), kind=codex_extension_wait(item))
    return max(cursor, end)


def codex_extension_wait(item):
    if item.get("type") != "Extension":
        return None
    action = item.get("action") or {}
    if not isinstance(action, dict):
        return None
    return wait_kind(action.get("tool_name", ""))


def read_turn(agent, path, requested_turn=""):
    if agent not in {"claude", "codex"}:
        return Turn()
    with Path(path).open("rb") as stream:
        if agent == "claude":
            return claude_turn(stream)
        return codex_turn(stream, requested_turn)
