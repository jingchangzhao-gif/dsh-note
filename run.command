#!/bin/bash
# dsh-note launcher (macOS): forwards every argument to the CLI.
# Usage: ./run.command <command> [dir] [--flags...]
#   e.g.  ./run.command list ~/notes
#         ./run.command memory-recall ~/memory --query pnpm
cd "$(dirname "$0")"
exec node cli.mjs "$@"
