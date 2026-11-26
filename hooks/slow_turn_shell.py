"""Recognize passive shell commands without executing or expanding shell input."""

import os
import re
import shlex


TOKEN = re.compile(
    r"""(?P<space>[ \t]+)|(?P<comment>\#[^\n]*)|(?P<sep>\n|[;&|]+)"""
    r"""|(?P<redirect><<-?|<<<|[<>]+)"""
    r"""|(?P<word>(?:'[^']*'|"(?:\\.|[^"\\])*"|\\[\s\S]|[^ \t\n;&|<>'"\\])+)|(?P<bad>.)"""
)
ASSIGNMENT = re.compile(r"^[A-Za-z_]\w*=")


def commands(source):
    """Yield simple commands; quoted separators and here-doc bodies are data."""
    offset = 0
    words, heredocs = [], []
    redirect = ""
    while match := TOKEN.match(source, offset):
        offset = match.end()
        text = match[0]
        if match.lastgroup == "word":
            word = "".join(shlex.split(text))
            if redirect in ("<<", "<<-"):
                heredocs.append((word, redirect == "<<-"))
            if not redirect:
                words.append(word)
            redirect = ""
        elif match.lastgroup == "redirect":
            redirect = text
        elif match.lastgroup == "sep":
            if words:
                yield words
                words = []
            if "\n" in text:
                offset = skip_heredocs(source, offset, heredocs)
                heredocs.clear()
        elif match.lastgroup == "bad":
            return
    if words:
        yield words


def skip_heredocs(source, offset, heredocs):
    for delimiter, strip_tabs in heredocs:
        prefix = r"^\t*" if strip_tabs else "^"
        pattern = re.compile(prefix + re.escape(delimiter) + "$", re.MULTILINE)
        end = pattern.search(source, offset)
        offset = end.end() + 1 if end else len(source)
    return offset


def passive_command(words):
    while words and (ASSIGNMENT.match(words[0]) or words[0] in {"command", "exec", "env", "builtin"}):
        words = words[1:]
    if not words:
        return None
    name, *args = words
    name = os.path.basename(name)
    if name in {"bash", "zsh", "sh"} and len(args) == 2 and args[0] in {"-c", "-lc", "-ic"}:
        return shell_wait(args[1])
    if name == "sleep" and args:
        return "timer"
    if name in {"tail", "journalctl", "docker", "kubectl", "gh", "herdr", "phux"}:
        return watcher(name, args)
    return None


def watcher(name, args):
    if name == "gh":
        if args[:2] == ["run", "watch"] or (args[:2] == ["pr", "checks"] and "--watch" in args[2:]):
            return "watch"
    elif name in {"herdr", "phux"} and args[:2] in (["agent", "wait"], ["mail", "wait"]):
        return "idle"
    elif name in {"tail", "journalctl"} or "logs" in args:
        if any(arg in {"--follow", "-f", "-F"} or arg.startswith("--follow=") for arg in args):
            return "watch"
    return None


def shell_wait(command):
    if isinstance(command, list):
        return passive_command(command)
    for words in commands(command):
        kind = passive_command(words)
        if kind:
            return kind
    return None
