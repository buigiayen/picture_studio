import io

from PIL import Image

from server.compositor import CompositeError


class InvalidImageError(CompositeError):
    pass


def load_image_pixels(image_bytes):
    if not image_bytes:
        raise InvalidImageError("image data is empty")
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
        return img
    except CompositeError:
        raise
    except Exception as exc:
        raise InvalidImageError("unable to decode image: %s" % exc) from exc