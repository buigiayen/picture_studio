#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON=""
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi

"$PYTHON" -m grpc_tools.protoc \
  -I proto \
  --python_out=server/gen \
  --grpc_python_out=server/gen \
  proto/portrait.proto

touch server/gen/__init__.py

"$PYTHON" - <<'PY'
path = "server/gen/portrait_pb2_grpc.py"
with open(path) as handle:
    source = handle.read()
source = source.replace(
    "import portrait_pb2 as portrait__pb2",
    "from server.gen import portrait_pb2 as portrait__pb2",
)
with open(path, "w") as handle:
    handle.write(source)
PY

echo "generated protobuf code in server/gen/"