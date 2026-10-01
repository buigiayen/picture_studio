# Deploy BiRefNet lite ONNX trên VPS

Compose trong thư mục này chạy web, Envoy và worker xóa nền. Worker dùng
`onnx-community/BiRefNet_lite-ONNX` FP32 trên CPU, tải model về `/models`
ở lần chạy đầu, kiểm tra SHA256 và tái sử dụng qua volume `rembg-models`
theo mặc định hoặc thư mục host khi đặt `AI_MODELS_SOURCE`.
Không cần tải file `.onnx` vào Git hoặc đưa vào Docker image.

## Chuẩn bị image

Đẩy mã nguồn lên `main` và chờ workflow **Docker build & push to GHCR**
hoàn thành thành công cho **cả web và portrait**. Chỉ dùng tag mới sau khi
cả hai job đều xanh. Workflow tạo tag `latest` và tag `sha-...` cho cả hai image.
Nếu package GHCR riêng tư, đăng nhập `ghcr.io` trên VPS bằng token có quyền
`read:packages`: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry

## Chạy trên VPS Linux amd64

Cần Docker Engine, Docker Compose plugin và kết nối HTTPS ra `ghcr.io` và
`huggingface.co` cho lần tải model đầu tiên. Từ thư mục chứa repo:

```bash
git clone https://github.com/buigiayen/picture_studio.git
cd picture_studio/deploy
cp ../.env.example .env
```

Sửa `.env` tối thiểu:

```dotenv
TAG=latest
ALLOWED_DOMAINS=anh.example.com
WEB_PORT=3001
ONNX_SEGMENTATION_ENABLED=true
ONNX_MODEL_DTYPE=fp32
ONNX_EXECUTION_PROVIDERS=CPUExecutionProvider
ONNX_MODEL_WARMUP=true
AI_PROVIDERS_ORDER=
AI_MODELS_SOURCE=rembg-models
```

`ALLOWED_DOMAINS` phải khớp hostname người dùng truy cập, không gồm cổng.
Nếu dùng tag `sha-...` của workflow thì thay `TAG=latest` để cố định phiên bản.
Compose đọc `deploy/.env`; hai file `.env` trong `web_picture_studio` và
`grcp_worker_remove_bg` chỉ dùng khi chạy từng service ngoài Compose.
Web trong Compose đi qua Envoy bằng `grpc-web` dù `.env` chạy local dùng `native`.

```bash
docker compose pull
docker compose run --rm --no-deps portrait python -c 'from server.models.birefnet_lite import model_path; print(model_path("/models", "fp32"))'
docker compose up -d
docker compose ps
docker compose logs --tail=100 portrait
```

Log portrait cần có `ONNX model ready: local:birefnet-lite-fp32` và
`providers: local:birefnet-lite-fp32, local:rembg`. Mở web trên cổng 3001,
tải ảnh lên và chọn **Khử nền tự động**; kết quả cần hiển thị provider
`local:birefnet-lite-fp32`.

## Upload model thủ công

Để lưu model trong một thư mục trên VPS thay vì Docker volume, đặt trong
`deploy/.env`:

```dotenv
AI_MODELS_SOURCE=/srv/picture-studio/models
```

Sau `docker compose pull`, chuyển file FP32 đã kiểm tra SHA256 từ máy local
vào `/tmp/model.onnx` trên VPS:

```bash
scp /tmp/birefnet_lite_fp32.onnx USER@SERVER:/tmp/model.onnx
```

Sau đó chạy ở thư mục `deploy` trên VPS:

```bash
sudo mkdir -p /srv/picture-studio/models
docker compose run --rm --no-deps --user root -v /tmp/model.onnx:/tmp/model.onnx:ro portrait sh -c 'mkdir -p /models/birefnet-lite/de15b22ba131738a16dff04aab8bdf8dc32e3ac1 && cp /tmp/model.onnx /models/birefnet-lite/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/model.onnx && chown -R app:app /models'
docker compose run --rm --no-deps portrait python -c 'from server.models.birefnet_lite import model_path; print(model_path("/models", "fp32"))'
docker compose up -d
```

Lệnh Python kiểm tra SHA256. Nếu file sai hoặc không có, worker sẽ thử tải
bản đã pin từ Hugging Face. Thư mục host có thể dùng để sao lưu model.

## Cập nhật

Sau khi hai job GHCR của commit mới thành công:

```bash
git -C .. pull
docker compose pull
docker compose up -d
docker compose logs --tail=100 portrait
```

Docker volume hoặc thư mục host giữ model sau khi container được tạo lại.
Nếu dùng Docker volume, tránh `docker compose down -v` vì lệnh đó xóa volume.
