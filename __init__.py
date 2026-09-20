"""Hermes plugin for Ponytail on Stimulants.

Derived from DietrichGebert/ponytail under the MIT license.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable

DEFAULT_MODE = "full-send"
RUNTIME_MODES = {"off", "focused", "full-send", "feral"}
MODE_ALIASES = {"lite": "focused", "full": "full-send", "ultra": "feral"}
CONFIG_MODES = RUNTIME_MODES | {"review"}
SKILL_COMMANDS = {
    "ponytail-on-stimulants-review": "Review the current diff for unnecessary complexity and unfinished work.",
    "ponytail-on-stimulants-audit": "Audit the repo for incomplete execution and unjustified complexity.",
    "ponytail-on-stimulants-debt": "List deliberate shortcuts and their bounded upgrade paths.",
    "ponytail-on-stimulants-gain": "Show the benchmark and completion-measurement reference.",
    "ponytail-on-stimulants-help": "Show the Ponytail on Stimulants command reference.",
}

ROOT = Path(__file__).resolve().parent
SKILLS_DIR = ROOT / "skills"
MAIN_SKILL = SKILLS_DIR / "ponytail-on-stimulants" / "SKILL.md"
REVIEW_SKILL = SKILLS_DIR / "ponytail-on-stimulants-review" / "SKILL.md"
_current_mode = None


def _canonical_mode(mode: str | None) -> str | None:
    if not isinstance(mode, str):
        return None
    normalized = mode.strip().lower()
    return MODE_ALIASES.get(normalized, normalized)


def _normalize_runtime_mode(mode: str | None) -> str | None:
    mode = _canonical_mode(mode)
    return mode if mode in RUNTIME_MODES else None


def _normalize_config_mode(mode: str | None) -> str | None:
    mode = _canonical_mode(mode)
    return mode if mode in CONFIG_MODES else None


def _config_dir() -> Path:
    if os.environ.get("XDG_CONFIG_HOME"):
        return Path(os.environ["XDG_CONFIG_HOME"]) / "ponytail-on-stimulants"
    if os.name == "nt":
        base = os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")
        return Path(base) / "ponytail-on-stimulants"
    return Path.home() / ".config" / "ponytail-on-stimulants"


def _write_default_mode(mode: str) -> str | None:
    normalized = _normalize_runtime_mode(mode)
    if not normalized:
        return None
    config_dir = _config_dir()
    config_path = config_dir / "config.json"
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    config_dir.mkdir(parents=True, exist_ok=True)
    data["defaultMode"] = normalized
    config_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return normalized


def _default_mode() -> str:
    env_mode = _normalize_runtime_mode(os.environ.get("PONYTAIL_ON_STIMULANTS_DEFAULT_MODE"))
    if env_mode:
        return env_mode
    try:
        data = json.loads((_config_dir() / "config.json").read_text(encoding="utf-8"))
        file_mode = _normalize_runtime_mode(data.get("defaultMode"))
        if file_mode:
            return file_mode
    except Exception:
        pass
    return DEFAULT_MODE


def _strip_frontmatter(text: str) -> str:
    return re.sub(r"^---[\s\S]*?---\s*", "", text or "", count=1)


def _filter_skill_body_for_mode(body: str, mode: str) -> str:
    effective = _normalize_runtime_mode(mode) or DEFAULT_MODE
    lines = []
    for line in _strip_frontmatter(body).splitlines():
        table_label = re.match(r"^\|\s*\*\*(.+?)\*\*\s*\|", line)
        if table_label:
            label_mode = _normalize_runtime_mode(table_label.group(1))
            if label_mode and label_mode != effective:
                continue
        example_label = re.match(r'^-\s*([^:]+):\s*"', line)
        if example_label:
            label_mode = _normalize_runtime_mode(example_label.group(1))
            if label_mode and label_mode != effective:
                continue
        lines.append(line)
    return "\n".join(lines)


def _fallback_instructions(mode: str) -> str:
    return (
        f"PONYTAIL ON STIMULANTS ACTIVE — mode: {mode}\n\n"
        "Minimal architecture. Maximal execution. Understand and trace affected paths; "
        "choose the smallest sound design; implement the whole requested outcome and "
        "mechanically implied work; verify proportionately; perform an adversarial second "
        "pass; keep scope bounded."
    )


def build_injected_context(mode: str | None = None) -> str:
    """Return mode-filtered completion context for a Hermes LLM turn."""
    configured = _normalize_config_mode(mode) or _default_mode()
    if configured == "off":
        return ""
    if configured == "review":
        try:
            body = REVIEW_SKILL.read_text(encoding="utf-8")
            return f"PONYTAIL ON STIMULANTS ACTIVE — mode: review\n\n{_strip_frontmatter(body)}"
        except OSError:
            return "PONYTAIL ON STIMULANTS ACTIVE — mode: review. Review complexity and unfinished work."
    effective = _normalize_runtime_mode(configured) or DEFAULT_MODE
    try:
        body = MAIN_SKILL.read_text(encoding="utf-8")
        return f"PONYTAIL ON STIMULANTS ACTIVE — mode: {effective}\n\n{_filter_skill_body_for_mode(body, effective)}"
    except OSError:
        return _fallback_instructions(effective)


def _pre_llm_call(session_id: str = "", **_: Any) -> dict[str, str] | None:
    mode = _current_mode or _default_mode()
    context = build_injected_context(mode)
    return {"context": context} if context else None


def _skill_prompt(command: str, args: str = "") -> str:
    target = f"\n\nUser arguments: {args.strip()}" if args.strip() else ""
    return (
        f"Load and follow the Hermes plugin skill `ponytail-on-stimulants:{command}`. "
        f"{SKILL_COMMANDS[command]}{target}"
    )


def _slash_access_denied(event: Any, gateway: Any, command: str) -> bool:
    if gateway is None or event is None:
        return False
    checker = getattr(gateway, "_check_slash_access", None)
    source = getattr(event, "source", None)
    if checker is None or source is None:
        return False
    try:
        return checker(source, command) is not None
    except Exception:
        return True


def rewrite_gateway_command(event: Any = None, gateway: Any = None, **_: Any) -> dict[str, str] | None:
    """Rewrite authorized fork skill commands into normal agent prompts."""
    text = str(getattr(event, "text", "") or "").strip()
    if not text.startswith("/"):
        return None
    head, _, rest = text[1:].partition(" ")
    command = head.replace("_", "-").lower()
    if command not in SKILL_COMMANDS or _slash_access_denied(event, gateway, command):
        return None
    return {"action": "rewrite", "text": _skill_prompt(command, rest)}


def _handle_mode_command(raw_args: str) -> str:
    global _current_mode
    arg = (raw_args or "").strip().lower()
    parts = arg.split()
    if not parts or parts[0] == "status":
        mode = _current_mode or _default_mode()
        return f"Ponytail on Stimulants: current {mode}; default {_default_mode()}."
    if parts[0] == "default":
        written = _write_default_mode(parts[1] if len(parts) == 2 else "")
        return (
            f"Ponytail on Stimulants default mode set to {written}."
            if written
            else "Usage: /ponytail-on-stimulants default [focused|full-send|feral|off]"
        )
    mode = _normalize_runtime_mode(parts[0]) if len(parts) == 1 else None
    if not mode:
        return "Usage: /ponytail-on-stimulants [focused|full-send|feral|off|status|default <mode>]"
    _current_mode = mode
    return f"Ponytail on Stimulants mode set to {mode}."


def _make_skill_command_handler(ctx: Any, command: str) -> Callable[[str], str]:
    def handler(raw_args: str) -> str:
        prompt = _skill_prompt(command, raw_args or "")
        try:
            if ctx.inject_message(prompt):
                return f"Queued `{command}` for the agent."
        except Exception:
            pass
        return prompt
    return handler


def register(ctx: Any) -> None:
    """Register fork hooks, skills, and slash commands with Hermes."""
    for child in sorted(SKILLS_DIR.iterdir() if SKILLS_DIR.exists() else []):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)

    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("pre_gateway_dispatch", rewrite_gateway_command)
    ctx.register_command(
        "ponytail-on-stimulants",
        _handle_mode_command,
        description="Set execution mode, inspect status, or persist the default.",
        args_hint="[focused|full-send|feral|off|status|default <mode>]",
    )
    for command, description in SKILL_COMMANDS.items():
        ctx.register_command(
            command,
            _make_skill_command_handler(ctx, command),
            description=description,
            args_hint="[target or notes]",
        )
