import type { Metadata } from "next";
import { headers } from "next/headers";
import { getRequestDomainAccess } from "./access-control";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Studio Ảnh — Chỉnh sửa ảnh trực tuyến",
  description: "Mở ảnh từ link hoặc thiết bị, khử và đổi màu nền, cắt, xoay, điều chỉnh màu, vẽ và xuất ảnh.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const access = getRequestDomainAccess(requestHeaders.get("host"));

  return <html lang="vi"><body>{access.allowed ? children : <main className="access-denied">
    <section className="access-card" aria-labelledby="access-title">
      <div className="access-icon" aria-hidden="true">!</div>
      <p className="access-eyebrow">Truy cập bị giới hạn</p>
      <h1 id="access-title">Domain không được phép</h1>
      <p>
        {access.reason === "not-configured"
          ? "Hệ thống chưa được cấu hình domain được phép. Vui lòng liên hệ quản trị viên."
          : "Trang sửa ảnh chỉ hoạt động trên các domain đã được đăng ký bởi quản trị viên."}
      </p>
      <div className="access-identity">
        <span>Domain đang truy cập</span>
        <strong>{access.hostname ?? "Không xác định"}</strong>
      </div>
    </section>
  </main>}</body></html>;
}
