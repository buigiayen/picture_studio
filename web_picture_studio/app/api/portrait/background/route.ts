import { NextRequest } from "next/server";
import { getRequestDomainAccess } from "@/app/access-control";
import { callChangeBackground, PortraitGrpcError } from "@/lib/portrait-grpc-web";
import { callChangeBackgroundNative } from "@/lib/portrait-grpc-native";

export const runtime = "nodejs";

const MAX_INPUT_SIZE = 30 * 1024 * 1024;
const MAX_BASE64_INPUT_SIZE = Math.ceil(MAX_INPUT_SIZE / 3) * 4;
const MAX_OUTPUT_SIZE = 40 * 1024 * 1024;
const MAX_BASE64_OUTPUT_SIZE = Math.ceil(MAX_OUTPUT_SIZE / 3) * 4 + 128;
const decoder = new TextDecoder();

const textValue = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

const integerValue = (form: FormData, key: string, fallback: number, min: number, max: number) => {
  const value = Number(textValue(form, key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
};

function parseColor(value: string, transparent: boolean) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  const red = match ? Number.parseInt(match[1], 16) : 255;
  const green = match ? Number.parseInt(match[2], 16) : 255;
  const blue = match ? Number.parseInt(match[3], 16) : 255;
  return { red, green, blue, alpha: transparent ? 0 : 255 };
}

function cleanHeader(value: string, fallback: string) {
  const cleaned = value.replace(/[^\x20-\x7e]/g, "_").slice(0, 160);
  return cleaned || fallback;
}

function outputContentType(format: string) {
  const normalized = format.trim().toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  if (normalized === "avif") return "image/avif";
  return "image/png";
}

function detectImageContentType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && decoder.decode(bytes.slice(0, 4)) === "RIFF" && decoder.decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(decoder.decode(bytes.slice(0, 6)))) return "image/gif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (bytes.length >= 12 && decoder.decode(bytes.slice(4, 8)) === "ftyp" && ["avif", "avis"].includes(decoder.decode(bytes.slice(8, 12)))) return "image/avif";
  return null;
}

function decodeRequestBase64(value: string) {
  const withoutPrefix = value.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  let normalized = withoutPrefix.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || normalized.length > MAX_BASE64_INPUT_SIZE + 4 || !/^[a-z0-9+/]*={0,2}$/i.test(normalized) || normalized.length % 4 === 1) {
    throw new PortraitGrpcError("Dữ liệu ảnh Base64 gửi lên không hợp lệ hoặc vượt quá 30 MB.");
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  if (Math.floor(normalized.length * 3 / 4) - padding > MAX_INPUT_SIZE) {
    throw new PortraitGrpcError("Ảnh trước khi mã hóa Base64 vượt quá giới hạn 30 MB.");
  }
  normalized += "=".repeat((4 - normalized.length % 4) % 4);
  let binary: string;
  try { binary = atob(normalized); }
  catch { throw new PortraitGrpcError("Không thể giải mã ảnh Base64 trước khi gọi gRPC."); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (!detectImageContentType(bytes)) throw new PortraitGrpcError("Base64 gửi lên không chứa định dạng ảnh được hỗ trợ.");
  return bytes;
}

function normalizeResponseImage(payload: Uint8Array, outputFormat: string) {
  const rawType = detectImageContentType(payload);
  if (rawType) {
    if (payload.length > MAX_OUTPUT_SIZE) throw new PortraitGrpcError("Ảnh trả về vượt quá giới hạn 40 MB.");
    return { bytes: payload, contentType: rawType };
  }
  if (payload.length > MAX_BASE64_OUTPUT_SIZE) throw new PortraitGrpcError("Ảnh Base64 trả về vượt quá giới hạn 40 MB.");
  const text = decoder.decode(payload).trim();
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(text);
  let encoded = (dataUrl?.[2] ?? text).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!encoded || !/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 === 1) {
    throw new PortraitGrpcError("Dịch vụ gRPC không trả về ảnh nhị phân hoặc Base64 hợp lệ.");
  }
  encoded += "=".repeat((4 - encoded.length % 4) % 4);
  let binary: string;
  try { binary = atob(encoded); }
  catch { throw new PortraitGrpcError("Không thể giải mã ảnh Base64 do dịch vụ gRPC trả về."); }
  if (!binary.length || binary.length > MAX_OUTPUT_SIZE) throw new PortraitGrpcError("Ảnh Base64 trả về vượt quá giới hạn 40 MB.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const contentType = detectImageContentType(bytes) ?? dataUrl?.[1].toLowerCase() ?? outputContentType(outputFormat);
  return { bytes, contentType };
}

export async function POST(request: NextRequest) {
  if (!getRequestDomainAccess(request.headers.get("host")).allowed) {
    return Response.json({ error: "Domain không được phép sử dụng tính năng này." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const requestHost = request.headers.get("host") ?? request.nextUrl.host;
      if (new URL(origin).host !== requestHost) return Response.json({ error: "Yêu cầu khác nguồn bị từ chối." }, { status: 403 });
    } catch { return Response.json({ error: "Origin không hợp lệ." }, { status: 400 }); }
  }
  const endpoint = process.env.PORTRAIT_GRPC_URL?.trim();
  if (!endpoint) return Response.json({ error: "Chưa cấu hình PORTRAIT_GRPC_URL trên server." }, { status: 503 });
  const transport = (process.env.PORTRAIT_GRPC_TRANSPORT || "native").trim().toLowerCase();
  if (!["native", "grpc-web"].includes(transport)) {
    return Response.json({ error: "PORTRAIT_GRPC_TRANSPORT phải là native hoặc grpc-web." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const imageBytes = decodeRequestBase64(textValue(form, "imageBase64"));
    const transparent = textValue(form, "backgroundMode") !== "color";
    const beautyStrength = textValue(form, "beautyStrength");
    const input = {
      image: imageBytes,
      backgroundColor: parseColor(textValue(form, "backgroundColor"), transparent),
      imageName: textValue(form, "imageName").replace(/[\0\r\n]/g, "").slice(0, 240) || "portrait.png",
      outputFormat: textValue(form, "outputFormat") || "png",
      maxDimension: integerValue(form, "maxDimension", 0, 0, 6000),
      sharpness: integerValue(form, "sharpness", 0, 0, 100),
      beautyStrength: beautyStrength ? integerValue(form, "beautyStrength", 0, 0, 100) : undefined,
    };
    const options = {
      token: process.env.PORTRAIT_GRPC_TOKEN?.trim(),
      timeoutMs: Number(process.env.PORTRAIT_GRPC_TIMEOUT_MS) || 60_000,
    };
    const output = transport === "native"
      ? await callChangeBackgroundNative(endpoint, input, options)
      : await callChangeBackground(endpoint, input, options);
    const responseImage = normalizeResponseImage(output.image, output.outputFormat);
    const imageName = cleanHeader(output.imageName, `portrait-no-bg.${output.outputFormat || "png"}`);
    return new Response(new Blob([responseImage.bytes.slice().buffer], { type: responseImage.contentType }), {
      headers: {
        "Content-Type": responseImage.contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Portrait-Image-Name": imageName,
        "X-Portrait-Provider": cleanHeader(output.providerUsed, "unknown"),
        "X-Portrait-Latency-Ms": String(Math.max(0, output.latencyMs || 0)),
        "X-Portrait-Width": String(Math.max(0, output.width || 0)),
        "X-Portrait-Height": String(Math.max(0, output.height || 0)),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return Response.json({ error: "Dịch vụ gRPC xử lý quá thời gian cho phép." }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : "Không thể kết nối dịch vụ gRPC xử lý ảnh.";
    return Response.json({ error: message.slice(0, 300) }, { status: 502 });
  }
}
