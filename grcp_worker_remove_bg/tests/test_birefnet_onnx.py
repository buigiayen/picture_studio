import hashlib
import io

import numpy as np
from PIL import Image

from server.models import birefnet_lite
from server.segmentation.birefnet_onnx import (
    BiRefNetOnnxSegmenter,
    alpha_from_logits,
    preprocess,
)


def test_preprocess_uses_image_net_rgb_normalization():
    tensor = preprocess(Image.new("RGB", (8, 4), (255, 0, 0)))
    assert tensor.shape == (1, 3, 1024, 1024)
    assert tensor.dtype == np.float32
    np.testing.assert_allclose(tensor[0, :, 0, 0],
                               [(1 - 0.485) / 0.229, -0.456 / 0.224, -0.406 / 0.225],
                               rtol=1e-5)


def test_logits_become_soft_alpha_without_threshold():
    logits = np.zeros((1, 1, 1024, 1024), dtype=np.float32)
    logits[0, 0, 0, 0] = -80
    logits[0, 0, 0, 1] = 80
    mask = alpha_from_logits(logits, (1024, 1024))
    assert mask.getpixel((0, 0)) == 0
    assert mask.getpixel((1, 0)) == 255
    assert mask.getpixel((2, 0)) == 128


def test_segmenter_preserves_existing_transparency():
    class FakeInput:
        name = "input_image"

    class FakeSession:
        def get_inputs(self):
            return [FakeInput()]

        def run(self, _, feeds):
            assert feeds["input_image"].shape == (1, 3, 1024, 1024)
            return [np.zeros((1, 1, 1024, 1024), dtype=np.float32)]

    image = Image.new("RGBA", (2, 2), (200, 100, 50, 255))
    image.putpixel((0, 0), (200, 100, 50, 0))
    source = io.BytesIO()
    image.save(source, "PNG")
    segmenter = BiRefNetOnnxSegmenter("unused")
    segmenter._session = FakeSession()
    result = Image.open(io.BytesIO(segmenter.remove_background(source.getvalue())))
    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((1, 1))[3] == 128


def test_model_download_is_verified_and_cached(tmp_path, monkeypatch):
    payload = b"verified ONNX bytes"
    sha = hashlib.sha256(payload).hexdigest()
    monkeypatch.setitem(birefnet_lite.ARTIFACTS, "fp32", ("onnx/model.onnx", sha))
    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def raise_for_status(self):
            pass

        def iter_content(self, chunk_size):
            yield payload

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse()

    monkeypatch.setattr(birefnet_lite.requests, "get", fake_get)
    path = birefnet_lite.model_path(tmp_path)
    assert path.read_bytes() == payload
    assert birefnet_lite.model_path(tmp_path) == path
    assert len(calls) == 1

    path.write_bytes(b"corrupted")
    assert birefnet_lite.model_path(tmp_path).read_bytes() == payload
    assert len(calls) == 2
