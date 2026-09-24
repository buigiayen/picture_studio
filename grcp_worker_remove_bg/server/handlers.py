import io
import time

import grpc
from PIL import Image

from server.compositor import CompositeError
from server.config import Config
from server.gen import portrait_pb2, portrait_pb2_grpc
from server.images import InvalidImageError, load_image_pixels
from server.segmentation.base import SegmenterError


class PortraitService(portrait_pb2_grpc.PortraitServiceServicer):
    def __init__(self, config, registry, compositor):
        self.config = config
        self.registry = registry
        self.compositor = compositor

    def ChangeBackground(self, request, context):
        if not request.image:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "image is required")

        try:
            color = (
                request.background_color.red,
                request.background_color.green,
                request.background_color.blue,
                request.background_color.alpha or 255,
            )
            for channel in color:
                if not 0 <= channel <= 255:
                    raise CompositeError("color channels must be in range 0..255")
        except CompositeError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))

        output_format = (request.output_format or "png").lower().lstrip(".")
        if output_format not in ("png", "jpeg"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "output_format must be png or jpeg")

        sharpness = request.sharpness or 0
        if not 0 <= sharpness <= 100:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "sharpness must be in range 0..100")

        beauty_strength = (
            request.beauty_strength
            if request.HasField("beauty_strength")
            else self.config.beauty_strength
        )
        if not 0 <= beauty_strength <= 100:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "beauty_strength must be in range 0..100")

        max_dimension = request.max_dimension or None
        if max_dimension and max_dimension > self.config.max_dimension_limit:
            max_dimension = self.config.max_dimension_limit

        start = time.monotonic()
        try:
            load_image_pixels(request.image)
            subject, provider = self.registry.segment(request.image)
            output = self.compositor.composite_color(
                subject,
                color,
                max_dimension=max_dimension,
                output_format=output_format,
                sharpness=sharpness,
                beauty_strength=beauty_strength,
            )
        except InvalidImageError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except CompositeError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except SegmenterError as exc:
            context.abort(grpc.StatusCode.INTERNAL, str(exc))
        except Exception as exc:
            context.abort(grpc.StatusCode.INTERNAL, "processing failed: %s" % exc)
        latency_ms = (time.monotonic() - start) * 1000.0

        width, height = Image.open(io.BytesIO(output)).size

        return portrait_pb2.ChangeBackgroundResponse(
            image=output,
            image_name=request.image_name,
            output_format=output_format,
            provider_used=provider,
            latency_ms=latency_ms,
            width=width,
            height=height,
        )

    def Ping(self, request, context):
        return portrait_pb2.Pong(message="pong")

    def GetProviders(self, request, context):
        return portrait_pb2.ProviderList(providers=self.registry.names)
