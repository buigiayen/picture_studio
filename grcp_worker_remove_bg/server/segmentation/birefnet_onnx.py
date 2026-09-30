"""Local BiRefNet lite foreground matting with ONNX Runtime."""

import io
import threading

import numpy as np
from PIL import Image, ImageChops, ImageOps

from server.models.birefnet_lite import model_path
from server.segmentation.base import BaseSegmenter, SegmenterFailed, SegmenterUnavailable


INPUT_SIZE = (1024, 1024)
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(image):
    rgb = image.convert("RGB").resize(INPUT_SIZE, Image.Resampling.BILINEAR)
    pixels = np.asarray(rgb, dtype=np.float32) / 255.0
    pixels = (pixels - IMAGE_MEAN) / IMAGE_STD
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None], dtype=np.float32)


def alpha_from_logits(logits, size):
    output = np.squeeze(np.asarray(logits, dtype=np.float32))
    if output.shape != INPUT_SIZE[::-1] or not np.isfinite(output).all():
        raise ValueError("unexpected BiRefNet output shape or values: %s" % (output.shape,))
    alpha = 1.0 / (1.0 + np.exp(-np.clip(output, -80.0, 80.0)))
    mask = Image.fromarray(np.rint(alpha * 255).astype(np.uint8))
    return mask.resize(size, Image.Resampling.LANCZOS)


class BiRefNetOnnxSegmenter(BaseSegmenter):
    def __init__(self, cache_dir, dtype="fp32", execution_providers=None):
        self.cache_dir = cache_dir
        self.dtype = dtype
        self.execution_providers = execution_providers or ["CPUExecutionProvider"]
        self.name = "local:birefnet-lite-%s" % dtype
        self._session = None
        self._session_lock = threading.Lock()

    def _load_session(self):
        if self._session is not None:
            return self._session
        with self._session_lock:
            if self._session is not None:
                return self._session
            try:
                import onnxruntime as ort

                missing = set(self.execution_providers) - set(ort.get_available_providers())
                if missing:
                    raise ValueError("ONNX execution providers unavailable: %s" % ", ".join(sorted(missing)))
                path = model_path(self.cache_dir, self.dtype)
                self._session = ort.InferenceSession(str(path), providers=self.execution_providers)
            except Exception as exc:
                raise SegmenterUnavailable("unable to load %s: %s" % (self.name, exc)) from exc
        return self._session

    def warmup(self):
        session = self._load_session()
        tensor = np.zeros((1, 3, *INPUT_SIZE[::-1]), dtype=np.float32)
        try:
            session.run(None, {session.get_inputs()[0].name: tensor})
        except Exception as exc:
            raise SegmenterUnavailable("unable to warm up %s: %s" % (self.name, exc)) from exc
        return session.get_providers()

    def remove_background(self, image_bytes):
        session = self._load_session()
        try:
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes)))
            image.load()
            original_alpha = image.getchannel("A") if "A" in image.getbands() else None
            tensor = preprocess(image)
            logits = session.run(None, {session.get_inputs()[0].name: tensor})[0]
            alpha = alpha_from_logits(logits, image.size)
            if original_alpha is not None:
                alpha = ImageChops.multiply(alpha, original_alpha)
            subject = image.convert("RGBA")
            subject.putalpha(alpha)
            output = io.BytesIO()
            subject.save(output, format="PNG")
            return output.getvalue()
        except Exception as exc:
            raise SegmenterFailed(self.name, str(exc)) from exc
