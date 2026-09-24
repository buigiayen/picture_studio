import argparse
import sys
from pathlib import Path

import grpc

ABSOLUTE_PACKAGE_ERROR = "generated grpc modules must be importable; run scripts/gen_proto.sh first"
try:
    from server.gen import portrait_pb2, portrait_pb2_grpc
except ImportError as exc:
    print(ABSOLUTE_PACKAGE_ERROR, file=sys.stderr)
    sys.exit(1)


def parse_color(text):
    text = text.strip().lstrip("#")
    if len(text) != 6:
        raise argparse.ArgumentTypeError("color must be hex like FF0000 or #FF0000")
    try:
        return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise argparse.ArgumentTypeError("invalid hex color")


def build_request(args):
    image_path = Path(args.image)
    if not image_path.is_file():
        print("input image not found: %s" % image_path, file=sys.stderr)
        sys.exit(1)

    r, g, b = args.color
    request = portrait_pb2.ChangeBackgroundRequest(
        image=image_path.read_bytes(),
        image_name=image_path.name,
        background_color=portrait_pb2.Color(red=r, green=g, blue=b, alpha=255),
        output_format=args.format,
        max_dimension=args.max_dimension,
        sharpness=args.sharpness,
    )
    if args.beauty is not None:
        request.beauty_strength = args.beauty
    return request


def main():
    parser = argparse.ArgumentParser(description="Portrait background changer gRPC client")
    parser.add_argument("image", help="path to input image")
    parser.add_argument("-o", "--output", default="output.png", help="output image path")
    parser.add_argument("-c", "--color", type=parse_color, default=(255, 255, 255), help="background color, hex (default white)")
    parser.add_argument("-a", "--address", default="127.0.0.1:50051", help="server address")
    parser.add_argument("-f", "--format", default="png", choices=["png", "jpeg"], help="output format")
    parser.add_argument("-m", "--max-dimension", type=int, default=0, help="downscale longest edge to this size")
    parser.add_argument("-s", "--sharpness", type=int, default=0, help="increase sharpness, 0..100")
    parser.add_argument(
        "-b",
        "--beauty",
        type=int,
        choices=range(0, 101),
        metavar="0..100",
        help="skin brightening and blemish reduction (server default: 35; 0 disables)",
    )
    args = parser.parse_args()

    max_message_size = 64 * 1024 * 1024
    channel = grpc.insecure_channel(
        args.address,
        options=[
            ("grpc.max_receive_message_length", max_message_size),
            ("grpc.max_send_message_length", max_message_size),
        ],
    )
    stub = portrait_pb2_grpc.PortraitServiceStub(channel)

    try:
        response = stub.ChangeBackground(build_request(args), timeout=120)
    except grpc.RpcError as exc:
        print("request failed: code=%s details=%s" % (exc.code().name, exc.details()), file=sys.stderr)
        sys.exit(1)

    out = Path(args.output)
    out.write_bytes(response.image)
    print("saved %s (%dx%d, %s, provider=%s, latency=%.1fms)" % (
        out, response.width, response.height, response.output_format, response.provider_used, response.latency_ms,
    ))


if __name__ == "__main__":
    main()
