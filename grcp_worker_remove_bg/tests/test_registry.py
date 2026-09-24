from server.segmentation.base import SegmenterError
from server.segmentation.registry import SegmenterRegistry


class FakeSegmenter:
    name = "fake:%s"

    def __init__(self, label, output=None, error=None):
        self.name = self.name % label
        self.output = output or b"fake-output"
        self.error = error

    def remove_background(self, image_bytes):
        if self.error:
            raise self.error
        return self.output


def test_registry_returns_first_successful_provider():
    good = FakeSegmenter("good", output=b"png-data")
    bad = FakeSegmenter("bad", error=SegmenterError("boom"))
    registry = SegmenterRegistry([bad, good])
    data, name = registry.segment(b"input")
    assert data == b"png-data"
    assert name == "fake:good"


def test_registry_falls_back_when_first_fails():
    bad = FakeSegmenter("bad", error=SegmenterError("boom"))
    good = FakeSegmenter("good", output=b"png-data")
    registry = SegmenterRegistry([bad, good])
    data, name = registry.segment(b"input")
    assert name == "fake:good"


def test_registry_raises_last_error_when_all_fail():
    first = FakeSegmenter("first", error=SegmenterError("first failure"))
    last = FakeSegmenter("last", error=SegmenterError("last failure"))
    registry = SegmenterRegistry([first, last])
    try:
        registry.segment(b"input")
    except SegmenterError as exc:
        assert str(exc) == "last failure"
    else:
        raise AssertionError("expected SegmenterError")


def test_registry_raises_when_empty():
    try:
        SegmenterRegistry([]).segment(b"input")
    except SegmenterError:
        pass
    else:
        raise AssertionError("expected SegmenterError")


def test_registry_names():
    registry = SegmenterRegistry([FakeSegmenter("a"), FakeSegmenter("b")])
    assert registry.names == ["fake:a", "fake:b"]