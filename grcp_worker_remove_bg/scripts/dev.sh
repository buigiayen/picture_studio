#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/gen_proto.sh

PYTHON=""
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi

"$PYTHON" -m pytest tests -q