#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${1:-}"
OUT="${2:-output.png}"
COLOR="${3:-FFFFFF}"

if [ -z "$IMAGE" ]; then
  echo "usage: $0 <input-image> [output.png] [HEXCOLOR]" >&2
  exit 1
fi

.venv/bin/python -m client.client "$IMAGE" -o "$OUT" -c "$COLOR" -a "127.0.0.1:50051"