# Tài liệu tích hợp: Mở ảnh từ link — cho các website bên thứ ba

Tài liệu này hướng dẫn website khác dùng JavaScript truyền link ảnh sang
Studio Ảnh để mở và chỉnh sửa ảnh, hoặc dùng API proxy để tải ảnh về qua
trung gian. Nội dung là plain text Markdown, các ví dụ JS đều chạy được
trên trình duyệt hiện đại.

## 1. Tổng quan

- **1a. Deep-link mở editor:** website truyền link ảnh dạng
  `?image=<URL mã hóa>`; Studio Ảnh tự tải ảnh, hiển thị và cho phép chỉnh sửa.
  Đây là cách phổ biến để "chuyển link" từ web khác sang trình sửa ảnh.
- **1b. API proxy ảnh:** endpoint `/api/image?url=<URL mã hóa>` dùng để lấy ảnh
  qua trung gian khi ảnh nguồn không cho phép truy cập trực tiếp (chuẩn hóa
  content-type, xử lý redirect, giới hạn 15 MB).

Cả hai đều yêu cầu domain gọi tới nằm trong allowlist `ALLOWED_DOMAINS`
(xem mục 5). Kiểm tra dựa trên `Host` header, không dựa vào JavaScript.

## 2. Cách làm việc theo chiến dịch của link

```
Web khác (JS)                     Studio Ảnh
     |                                  |
     |-- window.open(editor?image=URL)->|  (1a) tải ảnh, mở editor
     |                                  |
     |-- fetch(/api/image?url=URL) ---->|  (1b) proxy qua trung gian
     |<-- blob ảnh hoặc JSON lỗi  -----|
```

- `imageUrl` phải là link HTTP/HTTPS công khai, có phần mở rộng hoặc nội dung ảnh
  (PNG, JPEG, WebP, GIF, AVIF, BMP).
- Server không chấp nhận link tới máy cục bộ, IP thuần, link chuyển hướng vòng,
  ảnh quá 15 MB, hoặc nội dung không phải ảnh.
- Server tự nhận diện loại ảnh bằng magic bytes, nên không bắt buộc server nguồn
  trả đúng `Content-Type` (ví dụ S3 trả `application/octet-stream` vẫn hoạt động).

## 3. Tích hợp bằng JS — mở editor với ảnh từ link

```js
// Bước 1: mở trang editor và truyền link ảnh nguồn.
// Thay BASE_URL bằng địa chỉ Studio Ảnh đã triển khai, ví dụ:
// https://anh.congty.vn  hoặc  http://localhost:5173
const BASE_URL = "https://anh.congty.vn";

function openEditorWithImage(imageUrl) {
  const encoded = encodeURIComponent(imageUrl);
  const editorUrl = `${BASE_URL}/?image=${encoded}`;
  window.open(editorUrl, "_blank");
  // Lưu ý popup bị chặn: gọi hàm này TRONG một sự kiện click của người dùng.
}

// Dùng thử:
// <button onclick="openEditorWithImage('https://s3.aqy.vn/xxx.png')">Sửa ảnh</button>
```

Hoặc xử lý cùng lúc nhiều ảnh (mỗi tab một ảnh):

```js
function openEditorForEach(images) {
  for (const url of images) openEditorWithImage(url);
}
```

### Ghi chú về popup

Trình duyệt chặn `window.open` gọi không nằm trong sự kiện người dùng. Luôn gọi
hàm này ngay trong handler `click`/`submit`, không gọi bên trong `setTimeout`,
`await fetch(...)` hoặc callback bất đồng bộ.

## 4. Tích hợp bằng JS — gọi trực tiếp API proxy

Dùng khi muốn tải ảnh về qua trung gian để dùng ở web của bạn.

```js
async function fetchImageViaProxy(imageUrl) {
  const api = `https://anh.congty.vn/api/image?url=${encodeURIComponent(imageUrl)}`;
  const response = await fetch(api);

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Lỗi HTTP ${response.status}`);
  }

  const blob = await response.blob(); // <Blob> ảnh, đã chuẩn hóa content-type
  return blob;
}
```

Ví dụ hiển thị ảnh tải qua proxy:

```js
const blob = await fetchImageViaProxy(imageUrl);
const objectURL = URL.createObjectURL(blob);
const img = document.createElement("img");
img.src = objectURL;
document.body.appendChild(img);
```

### Bảng lỗi trả về (JSON)

| HTTP | `error`                                            | Nghĩa                                        |
|------|----------------------------------------------------|----------------------------------------------|
| 200  | n/a (blob ảnh)                                     | Thành công                                   |
| 400  | Link ảnh không hợp lệ...                           | URL không phải HTTP(S) công khai             |
| 403  | Domain không được phép...                          | Domain gọi chưa nằm trong allowlist          |
| 413  | Ảnh vượt quá 15 MB.                                | File quá giới hạn                            |
| 415  | Link này không trả về tệp ảnh được hỗ trợ.          | Nội dung không nhận diện được loại ảnh       |
| 422  | Không thể tải ảnh (HTTP xxx). / Không truy cập được | Nguồn lỗi, redirect lòng vòng, timeout 12 giây |
| 422  | Ảnh vượt quá 15 MB. (khi không có Content-Length)   | File quá giới hạn phát hiện khi đọc stream   |

## 5. Yêu cầu cấu hình phía Studio Ảnh

- Biến môi trường `ALLOWED_DOMAINS` phải chứa domain của trang web gọi,
  phân tách bằng dấu phẩy:
  ```env
  ALLOWED_DOMAINS=anh.congty.vn,*.partner.vn,localhost
  ```
- `*.partner.vn` cho phép mọi subdomain nhưng không gồm chính `partner.vn`.
- Nếu để trống hoặc sai rule, mọi yêu cầu đều bị từ chối (HTTP 403).
- `/api/image` chạy trên server giới hạn 15 MB/ảnh và timeout 12 giây mỗi request.

## 6. Tự kiểm tra nhanh (không cần viết code)

```bash
# Trả về ảnh (HTTP 200):
curl -o out.png "https://anh.congty.vn/api/image?url=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' 'https://s3.aqy.vn/xxx.png')"

# Trả về JSON lỗi:
curl -i "https://anh.congty.vn/api/image?url=https%3A%2F%2Fexample.com%2Fnot-an-image.txt"
```

## 7. Tham chiếu cài đặt trong mã nguồn

- `app/api/image/route.ts`: logic proxy ảnh, whitelist MIME, sniff magic bytes,
  giới hạn 15 MB, xử lý redirect (tối đa 4 lần).
- `app/page.tsx` (hàm `openUrl`): đọc `?image=`/`?url=` và gọi `/api/image`.
- `app/access-control.ts`: kiểm tra allowlist domain theo `Host` header.