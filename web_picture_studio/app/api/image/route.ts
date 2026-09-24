import { NextRequest } from "next/server";
import { getRequestDomainAccess } from "@/app/access-control";

export const runtime = "edge";

const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"];

function detectImageType(bytes: Uint8Array): string | null {
  const b = (offset: number) => bytes[offset];
  const ascii = (offset: number, len: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + len));
  if (bytes.length >= 8 && b(0) === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ascii(0, 4) === "GIF8") return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 2 && b(0) === 0x42 && b(1) === 0x4d) return "image/bmp";
  if (bytes.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4).toLowerCase();
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }
  return null;
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !["80", "443"].includes(url.port)) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) return null;
    if (!host.includes(".") || /^\[?[0-9a-f:.]+\]?$/i.test(host) || host.includes("%")) return null;
    return url;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  if (!getRequestDomainAccess(request.headers.get("host")).allowed) {
    return Response.json({ error: "Domain không được phép sử dụng tính năng này." }, { status: 403 });
  }

  const raw = request.nextUrl.searchParams.get("url") || "";
  let url = safeUrl(raw);
  if (!url) return Response.json({ error: "Link ảnh không hợp lệ. Hãy dùng URL HTTP hoặc HTTPS công khai." }, { status: 400 });
  try {
    for (let i = 0; i < 4; i++) {
      const response: Response = await fetch(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location: string | null = response.headers.get("location");
        url = location ? safeUrl(new URL(location, url).toString()) : null;
        if (!url) return Response.json({ error: "Link chuyển hướng không hợp lệ." }, { status: 400 });
        continue;
      }
      if (!response.ok) return Response.json({ error: `Không thể tải ảnh (HTTP ${response.status}).` }, { status: 422 });
      const declared = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
      const limit = 15 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit) return Response.json({ error: "Ảnh vượt quá 15 MB." }, { status: 413 });
      if (!response.body) throw new Error("empty");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); return Response.json({ error: "Ảnh vượt quá 15 MB." }, { status: 413 }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const sniffed = detectImageType(bytes);
      const type = sniffed || (SUPPORTED_TYPES.includes(declared) ? declared : "");
      if (!type) return Response.json({ error: "Link này không trả về tệp ảnh được hỗ trợ." }, { status: 415 });
      return new Response(new Blob([bytes.buffer], { type }), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }
    return Response.json({ error: "Link chuyển hướng quá nhiều lần." }, { status: 422 });
  } catch {
    return Response.json({ error: "Không truy cập được ảnh. Hãy thử tải tệp ảnh lên từ thiết bị." }, { status: 422 });
  }
}
