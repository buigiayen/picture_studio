# Mã nguồn Studio Ảnh

Đây là mã nguồn đúng với phiên bản trang chỉnh sửa ảnh đã xuất bản.

## Khử và đổi nền

1. Mở ảnh rồi chọn công cụ **Nền** ở thanh bên trái.
2. Chọn **Trong suốt** hoặc **Màu nền** và màu mong muốn.
3. Bấm **Khử nền tự động**. Canvas hiện tại được xuất PNG và mã hóa thành Base64 để gửi tới API của ứng dụng. API giải mã ảnh về raw bytes rồi gọi method `portrait.PortraitService/ChangeBackground`; ảnh trả về sẽ thay thế ảnh trên canvas.
4. Có thể dùng **Hoàn tác** để quay lại ảnh trước khi xử lý.

### Dữ liệu ảnh gửi tới gRPC

Trước khi gọi gRPC, ứng dụng chuyển ảnh hiện có trên canvas thành chuỗi Base64 thuần:

```text
iVBORw0KGgo...
```

Phần tiền tố `data:image/png;base64,` được loại bỏ nếu có. Route `/api/portrait/background` giải mã chuỗi Base64 về raw bytes của file ảnh trước khi gán vào trường `bytes image` trong protobuf. Đây là định dạng mà gRPC server dùng `PIL.Image.open(...)` yêu cầu.

Phản hồi `bytes image` từ gRPC có thể là raw bytes ảnh hoặc chuỗi Base64; API tự nhận diện, giải mã và trả ảnh cho canvas.

### Cấu hình dịch vụ gRPC

```env
PORTRAIT_GRPC_URL=http://127.0.0.1:50051
PORTRAIT_GRPC_TRANSPORT=native
PORTRAIT_GRPC_TOKEN=optional-bearer-token
PORTRAIT_GRPC_TIMEOUT_MS=60000
```

- `PORTRAIT_GRPC_URL` là URL gốc của dịch vụ. API tự nối path `/portrait.PortraitService/ChangeBackground`.
- `PORTRAIT_GRPC_TRANSPORT` mặc định là `native`. Dùng `grpc-web` khi URL trỏ tới proxy hỗ trợ binary gRPC-Web.
- `PORTRAIT_GRPC_TOKEN` là Bearer token tùy chọn và chỉ tồn tại ở server.
- `PORTRAIT_GRPC_TIMEOUT_MS` mặc định 60 giây, giới hạn tối đa 120 giây.
- Chế độ `native` dùng HTTP/2 của Node.js và kết nối trực tiếp tới Python gRPC server. Chế độ này không chạy trong Cloudflare Workers/Vinext.
- Khi triển khai trên Cloudflare Workers/Vinext, cấu hình `grpc-web` và đặt một proxy gRPC-Web như Envoy phía trước server native.
- Ảnh gửi lên giới hạn 30 MB; ảnh trả về giới hạn 40 MB.

## Yêu cầu
- Node.js >= 22.13
- pnpm

## Chạy trên máy
```bash
pnpm install
pnpm dev:grpc
```
Mở http://localhost:5173. Lệnh này chạy Next.js trong Node.js runtime để route API có thể dùng native HTTP/2.

`pnpm dev` vẫn chạy bản Vinext/Cloudflare; chỉ dùng lệnh đó nếu đã cấu hình `PORTRAIT_GRPC_TRANSPORT=grpc-web` và có proxy gRPC-Web.

## Cấu hình domain được phép

Trang sửa ảnh không yêu cầu đăng nhập. Server chỉ mở trang và API cho hostname nằm trong allowlist `ALLOWED_DOMAINS`, khai báo bằng danh sách phân tách bởi dấu phẩy:

```env
ALLOWED_DOMAINS=anh.congty.vn,*.preview.congty.vn,localhost
```

- `anh.congty.vn` chỉ cho phép đúng hostname đó.
- `*.preview.congty.vn` cho phép các subdomain, nhưng không bao gồm chính `preview.congty.vn`.
- Thêm `localhost` nếu cần chạy development trên máy cá nhân; cổng truy cập không ảnh hưởng đến việc đối chiếu.
- Hệ thống từ chối mọi truy cập nếu biến này bị bỏ trống hoặc không có rule hợp lệ.

Kiểm tra allowlist được thực hiện ở server cho cả trang sửa ảnh và API tải ảnh, dựa trên `Host` header của request và không dựa vào JavaScript phía trình duyệt.

## Tạo bản build
```bash
pnpm build:grpc
pnpm start:grpc
```

## Mở ảnh qua đường dẫn
```js
const editorUrl = `http://localhost:3000/?image=${encodeURIComponent(imageUrl)}`;
window.open(editorUrl, '_blank');
```
Thay địa chỉ localhost bằng tên miền sau khi tự triển khai. `imageUrl` phải là liên kết HTTP(S) tới ảnh công khai; trang cũng có thể mở tệp từ máy.

## Tệp chính
- `app/page.tsx`: giao diện và công cụ chỉnh sửa ảnh.
- `app/api/image/route.ts`: tải ảnh công khai từ URL, giới hạn 15 MB.
- `app/api/portrait/background/route.ts`: nhận Base64, giải mã raw bytes và gọi dịch vụ gRPC.
- `lib/portrait-grpc-native.ts`: transport native gRPC/HTTP2 cho Node.js.
- `lib/portrait-grpc-web.ts`: codec protobuf dùng chung và transport gRPC-Web tùy chọn.
- `app/globals.css`: giao diện responsive.
- `public/favicon.svg`: biểu tượng.

Lưu ý: `.openai/hosting.json` chứa mã nhận dạng của trang đã xuất bản. Nếu tạo trang Sites mới từ mã nguồn này, hãy thay cấu hình dự án theo hướng dẫn của môi trường mới.
