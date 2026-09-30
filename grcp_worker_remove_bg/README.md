# Portrait Background Changer (gRPC)

Xóa nền ảnh bằng **BiRefNet lite ONNX** qua gRPC. Đầu ra là PNG nền trong suốt
hoặc ảnh ghép lên màu nền được chọn. Pipeline không cần nhận diện hay đếm người.

## Kiến trúc

```
                    ┌──────────────────────────── gRPC 50051 ────────────────────────────┐
 image + color  ──▶ │  server.handlers.PortraitService                                  │
                    │     │                                                            │
                    │     ▼                                                            │
                    │  SegmenterRegistry (fallback theo thứ tự)                        │
                    │     ├─▶ local:birefnet-lite-fp32 (ONNX, mặc định)                 │
                    │     ├─▶ local:rembg (ISNet, fallback)                            │
                    │     └─▶ external providers (chỉ khi cấu hình)                   │
                    │     ▼                                                            │
                    │  Compositor — hoà alpha, ghép lên màu nền, xuất PNG/JPEG          │
                    └───────────▶ image đã đổi nền (bytes) ────────────────────────────┘
```

BiRefNet lite xử lý ảnh RGB 1024×1024 theo `preprocessor_config.json` của model,
chuyển logits thành alpha mềm và resize mask về kích thước gốc. Không threshold
mask để giữ chi tiết tóc/viền. Nếu ONNX không tải/chạy được, registry dùng ISNet
local; API ngoài chỉ được gọi khi đặt `AI_PROVIDERS_ORDER`. Response trả
`provider_used` để biết model thực tế. Ảnh nền trong suốt dùng
`transparent_background=true`; client cũ không gửi cờ này vẫn nhận nền đục.

## Cấu trúc thư mục

```
proto/portrait.proto               # định nghĩa service gRPC
server/
  config.py                        # đọc .env / env vars
  handlers.py                      # implement gRPC service
  server.py                        # entrypoint
  compositor.py                    # ghép chủ thể lên màu nền + làm mượt alpha
  segmentation/
    base.py                        # BaseSegmenter + exception
    birefnet_onnx.py              # tiền/hậu xử lý + inference BiRefNet lite
    local.py                       # rembg/ISNet fallback
    registry.py                    # danh sách provider + fallback
    providers/{removebg,clipdrop}.py
  gen/                             # code protobuf sinh tự động
  models/birefnet_lite.py         # revision, SHA256, cache model
client/client.py                   # CLI client demo
scripts/{gen_proto,dev,demo}.sh
tests/                             # pytest (không cần network/model)
```

## Cài đặt

```bash
make setup                  # tạo .venv + cài requirements
cp .env.example .env        # cấu hình ONNX, không cần API key
```

Lần chạy đầu, worker tải `onnx-community/BiRefNet_lite-ONNX` FP32 (~224 MB)
vào `~/.cache/picture_studio/models` khi chạy local hoặc `/models` trong Docker.
File được pin ở revision `de15b22ba131738a16dff04aab8bdf8dc32e3ac1`,
kiểm tra SHA256 trước khi load và tái sử dụng sau restart. Cần mạng ở lần tải
đầu; sau đó inference chạy local. FP32 là mặc định cho CPU. FP16 (~115 MB) là
tùy chọn cho runtime/provider hỗ trợ.
Model và cấu hình tiền xử lý: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX
(MIT).

## Chạy

```bash
make server                 # gen proto + start server trên 0.0.0.0:50051
make demo 1.jpg out.png FF0000   # terminal khác: đổi nền 1.jpg sang đỏ
```

Hoặc gọi client trực tiếp:

```bash
.venv/bin/python -m client.client 1.jpg -o out.png -c 00FF00 -a 127.0.0.1:50051
.venv/bin/python -m client.client 1.jpg -o out.jpg -f jpeg -m 1024
.venv/bin/python -m client.client 1.jpg -o out.png -c FFFFFF -s 60 -b 35   # nét + làm đẹp tự nhiên
```

## Test

```bash
make test                   # gen proto + pytest (compositor, registry, config)
```

## Cấu hình chính (.env)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORTRAIT_HOST/PORT` | `0.0.0.0:50051` | địa chỉ server |
| `ONNX_SEGMENTATION_ENABLED` | `true` | bật BiRefNet lite ONNX |
| `ONNX_MODEL_DTYPE` | `fp32` | `fp32` (CPU) hoặc `fp16` |
| `ONNX_MODEL_CACHE_DIR` | `~/.cache/picture_studio/models` | thư mục cache persistent; Docker dùng `/models` |
| `ONNX_EXECUTION_PROVIDERS` | `CPUExecutionProvider` | danh sách provider ONNX Runtime, ngăn cách bằng dấu phẩy |
| `ONNX_MODEL_WARMUP` | `true` | tải/load và chạy warmup khi khởi động |
| `LOCAL_SEGMENTATION_ENABLED` | `true` | bật rembg/ISNet fallback |
| `LOCAL_SEGMENTATION_MODEL` | `isnet-general-use` | model rembg fallback |
| `AI_PROVIDERS_ORDER` | trống | API fallback tùy chọn (`remove.bg,clipdrop`) |
| `AI_REMOVEBG_API_KEY` | trống | key remove.bg (https://remove.bg) |
| `AI_CLIPDROP_API_KEY` | trống | key ClipDrop (https://clipdrop.co) |
| `MAX_DIMENSION_LIMIT` | `4096` | giới hạn cạnh dài nhất |
| `ALPHA_FEATHER` | `0` | làm mờ alpha sau inference nếu cần; mặc định giữ viền gốc |
| `BEAUTY_STRENGTH` | `35` | làm sáng da và giảm mụn mặc định (`0..100`, `0` để tắt) |

## Ví dụ gọi bằng grpc (proto hoàn chỉnh)

```python
import grpc
from server.gen import portrait_pb2, portrait_pb2_grpc

ch = grpc.insecure_channel("127.0.0.1:50051")
stub = portrait_pb2_grpc.PortraitServiceStub(ch)
resp = stub.ChangeBackground(portrait_pb2.ChangeBackgroundRequest(
    image=open("1.jpg", "rb").read(),
    image_name="1.jpg",
    background_color=portrait_pb2.Color(red=255, green=0, blue=0, alpha=255),
    sharpness=50,  # 0..100, tăng độ sắc nét
    beauty_strength=35,  # 0..100, sáng da + giảm mụn; 0 để tắt
))
open("out.png", "wb").write(resp.image)
print(resp.provider_used, resp.latency_ms)
```

## Chạy với Docker

```bash
make docker-up               # docker compose up -d --build (port 50051)
make docker-logs             # xem log
```

Model ONNX và rembg dùng volume `rembg-models` hiện có (giữ lại khi restart).
Chạy `cp ../.env.example ../.env` nếu muốn đổi cấu hình Compose.
Client gọi trực tiếp từ máy host:

```bash
.venv/bin/python -m client.client 1.jpg -o out.png -c FFFFFF -s 60 -a 127.0.0.1:50051
```

Cấu hình qua biến môi trường (xem `docker-compose.yml` — kế thừa từ `.env` khi có).
Dừng: `make docker-down`.

## Mở rộng AI provider mới

1. Tạo class kế thừa `BaseSegmenter` trong `server/segmentation/providers/`.
2. Đăng ký trong `SegmenterRegistry.from_config` và thêm key cấu hình.
3. Thêm tên provider vào `AI_PROVIDERS_ORDER`.
