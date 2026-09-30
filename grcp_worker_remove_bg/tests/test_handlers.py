import io

from PIL import Image

from server.compositor import Compositor
from server.config import Config
from server.gen import portrait_pb2
from server.handlers import PortraitService


def test_change_background_keeps_transparent_color_alpha():
    subject = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    subject.paste(Image.new("RGBA", (8, 8), (255, 0, 0, 255)), (4, 4))
    buffer = io.BytesIO()
    subject.save(buffer, "PNG")

    class FakeRegistry:
        def segment(self, _):
            return buffer.getvalue(), "fake"

    service = PortraitService(Config(env={}), FakeRegistry(), Compositor())
    request = portrait_pb2.ChangeBackgroundRequest(
        image=buffer.getvalue(),
        background_color=portrait_pb2.Color(red=255, green=255, blue=255, alpha=0),
        transparent_background=True,
    )
    response = service.ChangeBackground(request, None)
    output = Image.open(io.BytesIO(response.image)).convert("RGBA")
    assert output.getpixel((0, 0))[3] == 0
    assert output.getpixel((8, 8))[3] == 255


def test_change_background_defaults_to_opaque_for_existing_clients():
    subject = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    buffer = io.BytesIO()
    subject.save(buffer, "PNG")

    class FakeRegistry:
        def segment(self, _):
            return buffer.getvalue(), "fake"

    service = PortraitService(Config(env={}), FakeRegistry(), Compositor())
    request = portrait_pb2.ChangeBackgroundRequest(
        image=buffer.getvalue(),
        background_color=portrait_pb2.Color(red=10, green=20, blue=30),
    )
    response = service.ChangeBackground(request, None)
    output = Image.open(io.BytesIO(response.image)).convert("RGBA")
    assert output.getpixel((0, 0)) == (10, 20, 30, 255)
