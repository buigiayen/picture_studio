# Portrait Background Changer (gRPC)

Chuyển đổi ảnh chân dung sang ảnh nền màu mong muốn qua **gRPC**.
Đầu vào: 1 ảnh + mã màu nền. Đầu ra: ảnh đã tách nền và ghép vào màu nền mới.

## Kiến trúc

```
                    ┌──────────────────────────── gRPC 50051 ────────────────────────────┐
 image + color  ──▶ │  server.handlers.PortraitService                                  │
                    │     │                                                            │
                    │     ▼                                                            │
                    │  SegmenterRegistry (fallback theo thứ tự)                        │
                    │     ├─▶ local:rembg        (U2Net/ISNet, chạy local, KHÔNG cần key)│
                    │     ├─▶ ai:remove.bg       (nếu AI_REMOVEBG_API_KEY có)           │
                    │     └─▶ ai:clipdrop        (nếu AI_CLIPDROP_API_KEY có)           │
                    │     ▼                                                            │
                    │  Compositor — hoà alpha, ghép lên màu nền, xuất PNG/JPEG          │
                    └───────────▶ image đã đổi nền (bytes) ────────────────────────────┘
```

Nguyên lý fallback: thử `local:rembg` trước (rẻ, nội bộ); nếu thiếu model/import lỗi thì
tự động chuyển sang các AI provider cấu hình. Dùng `provider_used` trong response để biết
provider nào được dùng. Mỗi provider kế thừa `BaseSegmenter` (server/segmentation/base.py) —
chỉ cần cài thêm class mới là mở rộng được.

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
    local.py                       # rembg (local deep-learning)
    registry.py                    # danh sách provider + fallback
    providers/{removebg,clipdrop}.py
  gen/                             # code protobuf sinh tự động
client/client.py                   # CLI client demo
scripts/{gen_proto,dev,demo}.sh
tests/                             # pytest (không cần network/model)
```

## Cài đặt

```bash
make setup                  # tạo .venv + cài requirements
cp .env.example .env        # điền AI key (tuỳ chọn, local rembg không cần)
```

> Lần đầu chạy local, rembg tự tải model (~170MB) vào `~/.u2net`.

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
| `LOCAL_SEGMENTATION_ENABLED` | `true` | bật/tắt segmenter local |
| `LOCAL_SEGMENTATION_MODEL` | `isnet-general-use` | model rembg (vd `u2net`) |
| `AI_PROVIDERS_ORDER` | `remove.bg,clipdrop` | thứ tự fallback |
| `AI_REMOVEBG_API_KEY` | trống | key remove.bg (https://remove.bg) |
| `AI_CLIPDROP_API_KEY` | trống | key ClipDrop (https://clipdrop.co) |
| `MAX_DIMENSION_LIMIT` | `4096` | giới hạn cạnh dài nhất |
| `ALPHA_FEATHER` | `2` | làm mượt viền (giảm nhiễu viền) |
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

Model rembg lần đầu tự tải (~170MB) vào volume `rembg-models` (giữ lại khi restart).
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
