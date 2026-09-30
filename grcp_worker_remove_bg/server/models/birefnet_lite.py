"""Download and verify the pinned BiRefNet lite ONNX weights."""

import hashlib
import os
import tempfile
from pathlib import Path

import requests


MODEL_ID = "onnx-community/BiRefNet_lite-ONNX"
REVISION = "de15b22ba131738a16dff04aab8bdf8dc32e3ac1"
ARTIFACTS = {
    "fp32": ("onnx/model.onnx", "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333"),
    "fp16": ("onnx/model_fp16.onnx", "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402"),
}


def model_path(cache_dir, dtype="fp32"):
    if dtype not in ARTIFACTS:
        raise ValueError("ONNX_MODEL_DTYPE must be fp32 or fp16")
    filename, expected_sha256 = ARTIFACTS[dtype]
    path = Path(cache_dir).expanduser() / "birefnet-lite" / REVISION / Path(filename).name
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.is_file() and _sha256(path) == expected_sha256:
        return path

    url = "https://huggingface.co/%s/resolve/%s/%s" % (MODEL_ID, REVISION, filename)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".download-", delete=False) as target:
            temporary = Path(target.name)
            digest = hashlib.sha256()
            with requests.get(url, stream=True, timeout=(15, 120)) as response:
                response.raise_for_status()
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        target.write(chunk)
                        digest.update(chunk)
        if digest.hexdigest() != expected_sha256:
            raise ValueError("downloaded ONNX model failed SHA256 verification")
        os.replace(temporary, path)
        return path
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
