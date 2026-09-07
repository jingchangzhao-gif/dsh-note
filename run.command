#!/bin/bash
# dsh-note cross-platform launcher (macOS).
# Usage: ./run.command [notes-directory]
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec node cli.mjs "$1"
