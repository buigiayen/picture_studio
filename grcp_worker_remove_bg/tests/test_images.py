import io

from PIL import Image

from server.images import InvalidImageError, load_image_pixels


def _png_bytes():
    img = Image.new("RGBA", (16, 16), (255, 0, 0, 255))
    buffer = io.BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def test_loads_valid_image():
    img = load_image_pixels(_png_bytes())
    assert img.size == (16, 16)


def test_rejects_truncated_image():
    truncated = _png_bytes()[:16]
    try:
        load_image_pixels(truncated)
    except InvalidImageError:
        pass
    else:
        raise AssertionError("expected InvalidImageError")


def test_rejects_empty_image():
    try:
        load_image_pixels(b"")
    except InvalidImageError:
        pass
    else:
        raise AssertionError("expected InvalidImageError")