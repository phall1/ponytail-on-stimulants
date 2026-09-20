#!/usr/bin/env bash
# CLAUDE_CONFIG_DIR overrides ~/.claude, matching where the hooks write the flag (issue #34)
flag="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.ponytail-on-stimulants-active"
[ -f "$flag" ] || exit 0

mode=$(head -n1 "$flag" | tr -d '[:space:]')

# feral is amber; the default full-send badge is green.
color=108
[ "$mode" = "feral" ] && color=173

if [ -z "$mode" ] || [ "$mode" = "full-send" ]; then
    printf '\033[38;5;%sm[PONYTAIL+]\033[0m' "$color"
else
    printf '\033[38;5;%sm[PONYTAIL+:%s]\033[0m' "$color" "$(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')"
fi
