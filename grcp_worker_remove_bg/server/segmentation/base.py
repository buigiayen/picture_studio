import io
from abc import ABC, abstractmethod

from PIL import Image

from server.compositor import CompositeError


class SegmenterError(Exception):
    pass


class SegmenterUnavailable(SegmenterError):
    pass


class SegmenterFailed(SegmenterError):
    def __init__(self, name, reason, status_code=None):
        self.segmenter_name = name
        self.reason = reason
        self.status_code = status_code
        super().__init__("%s failed: %s" % (name, reason))


class BaseSegmenter(ABC):
    name = "base"

    @abstractmethod
    def remove_background(self, image_bytes):
        raise NotImplementedError

    @staticmethod
    def validate_png_bytes(data):
        try:
            Image.open(io.BytesIO(data)).verify()
        except Exception as exc:
            raise CompositeError("segmentation provider returned invalid image data") from exc
        return data