from concurrent import futures

import grpc

from server.compositor import Compositor
from server.config import Config
from server.gen import portrait_pb2_grpc
from server.handlers import PortraitService
from server.segmentation.registry import SegmenterRegistry


def serve():
    config = Config()
    registry = SegmenterRegistry.from_config(config)
    compositor = Compositor(alpha_feather=config.alpha_feather, jpeg_quality=config.jpeg_quality)

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ("grpc.max_receive_message_length", config.max_message_size),
            ("grpc.max_send_message_length", config.max_message_size),
        ],
    )
    portrait_pb2_grpc.add_PortraitServiceServicer_to_server(
        PortraitService(config, registry, compositor),
        server,
    )
    server.add_insecure_port("%s:%d" % (config.host, config.port))
    server.start()
    print("portrait-service listening on %s:%d" % (config.host, config.port))
    print("providers: %s" % ", ".join(registry.names))
    server.wait_for_termination()


if __name__ == "__main__":
    serve()