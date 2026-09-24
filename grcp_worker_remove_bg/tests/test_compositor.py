import io
import random

from PIL import Image

from server.compositor import Compositor, CompositeError


def _gradient_subject(size=64):
    rng = random.Random(42)
    pixels = []
    for y in range(size):
        for x in range(size):
            base = int((x / size) * 200) + 30
            pixels.append((base + rng.randint(-15, 15), 100, 100, 255))
    img = Image.new("RGBA", (size, size))
    img.putdata(pixels)
    buffer = io.BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def _subject(size=(32, 32), square=(8, 8, 24, 24), color=(255, 0, 0, 255)):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    box_w = square[2] - square[0]
    box_h = square[3] - square[1]
    img.paste(Image.new("RGBA", (box_w, box_h), color), square)
    buffer = io.BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def _skin_subject(size=64):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    skin = Image.new("RGBA", (40, 40), (176, 124, 104, 255))
    skin.putpixel((20, 20), (90, 45, 40, 255))
    img.paste(skin, (12, 12))
    buffer = io.BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def test_composite_color_basic():
    result = Compositor().composite_color(_subject(), (0, 0, 255, 255))
    img = Image.open(io.BytesIO(result)).convert("RGBA")
    assert img.size == (32, 32)
    assert img.getpixel((4, 4))[0:3] == (0, 0, 255)
    r, g, b, a = img.getpixel((16, 16))
    assert (r, g, b) == (255, 0, 0)


def test_composite_color_keeps_original_size_when_within_limit():
    result = Compositor().composite_color(_subject(), (0, 0, 255, 255), max_dimension=64)
    img = Image.open(io.BytesIO(result))
    assert img.size == (32, 32)


def test_composite_color_downscales():
    subject = _subject(size=(64, 64), square=(16, 16, 48, 48))
    result = Compositor().composite_color(subject, (0, 0, 255, 255), max_dimension=32)
    img = Image.open(io.BytesIO(result))
    assert img.size == (32, 32)


def test_composite_color_jpeg_output():
    result = Compositor().composite_color(_subject(), (0, 0, 255, 255), output_format="jpeg")
    img = Image.open(io.BytesIO(result))
    assert img.format == "JPEG"
    assert img.size == (32, 32)


def test_composite_color_sharpens_when_requested():
    plain = Compositor().composite_color(_gradient_subject(), (0, 0, 255, 255))
    sharp = Compositor().composite_color(_gradient_subject(), (0, 0, 255, 255), sharpness=50)
    img = Image.open(io.BytesIO(sharp))
    assert img.size == (64, 64)
    assert sharp != plain


def test_composite_color_sharpness_zero_is_noop():
    plain = Compositor().composite_color(_subject(), (0, 0, 255, 255))
    same = Compositor().composite_color(_subject(), (0, 0, 255, 255), sharpness=0)
    assert same == plain


def test_composite_color_beautifies_skin_without_touching_background():
    plain = Compositor(alpha_feather=0).composite_color(
        _skin_subject(), (10, 20, 30, 255), beauty_strength=0
    )
    beauty = Compositor(alpha_feather=0).composite_color(
        _skin_subject(), (10, 20, 30, 255), beauty_strength=50
    )
    plain_img = Image.open(io.BytesIO(plain)).convert("RGB")
    beauty_img = Image.open(io.BytesIO(beauty)).convert("RGB")

    assert beauty_img.getpixel((32, 32)) != plain_img.getpixel((32, 32))
    assert beauty_img.getpixel((2, 2)) == (10, 20, 30)


def test_composite_color_rejects_invalid_beauty_strength():
    try:
        Compositor().composite_color(_subject(), (0, 0, 0, 255), beauty_strength=101)
    except CompositeError:
        pass
    else:
        raise AssertionError("expected CompositeError")


def test_composite_color_rejects_tiny_max_dimension():
    try:
        Compositor().composite_color(_subject(), (0, 0, 255, 255), max_dimension=4)
    except CompositeError:
        pass
    else:
        raise AssertionError("expected CompositeError")
