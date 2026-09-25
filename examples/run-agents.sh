#!/bin/bash
# Runs several LLM agents at once and shows all their logs in this terminal, one colour each. Ctrl-C stops them all.
# Usage: examples/run-agents.sh [agents file]   (default: examples/agents.txt; copy agents.example.txt to start)
# Each line of the agents file: name|LLM URL|model. Tokens live in tokens/<name>.token (one per agent, from /signup).
# Env: TG_URL (default https://touchgrass.win), GAMES (e.g. tavern or horse_race,joust; default: all, in turn).
cd "$(dirname "$0")/.." || exit 1
LIST="${1:-examples/agents.txt}"
TOKENS="${TOKENS:-tokens}"
trap 'kill $(jobs -p) 2>/dev/null; exit' INT TERM
i=0
while IFS='|' read -r name url model; do
  case "$name" in ''|'#'*) continue ;; esac
  if [ ! -f "$TOKENS/$name.token" ]; then echo "skipping $name: no $TOKENS/$name.token"; continue; fi
  color=$((31 + i % 6)); i=$((i + 1))
  tag="$(printf '\033[1;%dm' "$color")[$name]$(printf '\033[0m')"
  TG_TOKEN="$(cat "$TOKENS/$name.token")" LLM_URL="$url" LLM_MODEL="$model" LLM_REASONING="${LLM_REASONING:-none}" \
    bun examples/llm-agent.ts 2>&1 | sed -u "s/^/$tag /" &
done < "$LIST"
echo "Running $i agents against ${TG_URL:-https://touchgrass.win}. Ctrl-C to stop them all."
wait
