import { connect, constants, type IncomingHttpHeaders } from "node:http2";
import {
  decodeChangeBackground,
  encodeChangeBackground,
  frameMessage,
  PortraitGrpcError,
  type ChangeBackgroundInput,
} from "@/lib/portrait-grpc-web";

function methodUrl(base: string) {
  const url = new URL(base);
  if (!/^https?:$/.test(url.protocol)) throw new PortraitGrpcError("PORTRAIT_GRPC_URL phải dùng HTTP hoặc HTTPS.");
  const methodPath = "/portrait.PortraitService/ChangeBackground";
  if (!url.pathname.endsWith(methodPath)) url.pathname = `${url.pathname.replace(/\/$/, "")}${methodPath}`;
  url.search = "";
  url.hash = "";
  return url;
}

function readNativeMessage(body: Uint8Array) {
  if (body.length < 5) throw new PortraitGrpcError("Phản hồi native gRPC không có message.");
  const flag = body[0];
  if ((flag & 1) !== 0) throw new PortraitGrpcError("Phản hồi gRPC nén chưa được hỗ trợ.");
  const length = new DataView(body.buffer, body.byteOffset + 1, 4).getUint32(0, false);
  if (length <= 0 || body.length < length + 5) throw new PortraitGrpcError("Frame native gRPC bị cắt ngắn.");
  return decodeChangeBackground(body.slice(5, 5 + length));
}

function grpcError(status: string | string[] | undefined, message: string | string[] | undefined) {
  const code = Number(Array.isArray(status) ? status[0] : status);
  if (!Number.isFinite(code) || code === 0) return null;
  let detail = (Array.isArray(message) ? message[0] : message) || `gRPC status ${status}`;
  try { detail = decodeURIComponent(detail); } catch { /* Keep the original gRPC message. */ }
  return new PortraitGrpcError(detail, code);
}

export function callChangeBackgroundNative(
  endpoint: string,
  input: ChangeBackgroundInput,
  options: { token?: string; timeoutMs?: number } = {},
) {
  const target = methodUrl(endpoint);
  const timeoutMs = Math.min(120_000, Math.max(1_000, options.timeoutMs ?? 60_000));
  const origin = target.origin;

  return new Promise<ReturnType<typeof decodeChangeBackground>>((resolve, reject) => {
    const session = connect(origin);
    let settled = false;
    let responseHeaders: IncomingHttpHeaders = {};
    let responseTrailers: IncomingHttpHeaders = {};
    const chunks: Uint8Array[] = [];
    const finish = (error?: unknown, value?: ReturnType<typeof decodeChangeBackground>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.close();
      if (error) reject(error);
      else if (value) resolve(value);
      else reject(new PortraitGrpcError("Native gRPC kết thúc mà không có phản hồi."));
    };
    const timer = setTimeout(() => {
      session.destroy();
      finish(new PortraitGrpcError("Dịch vụ native gRPC xử lý quá thời gian cho phép."));
    }, timeoutMs);
    session.once("error", (error) => finish(new PortraitGrpcError(`Không thể kết nối native gRPC: ${error.message}`)));

    const headers: Record<string, string> = {
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: target.pathname,
      [constants.HTTP2_HEADER_SCHEME]: target.protocol.slice(0, -1),
      [constants.HTTP2_HEADER_AUTHORITY]: target.host,
      [constants.HTTP2_HEADER_CONTENT_TYPE]: "application/grpc+proto",
      te: "trailers",
      "grpc-timeout": `${timeoutMs}m`,
      "user-agent": "studio-anh/1.0",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const request = session.request(headers);
    request.on("response", (headersValue) => { responseHeaders = headersValue; });
    request.on("trailers", (trailersValue) => { responseTrailers = trailersValue; });
    request.on("data", (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
    request.once("error", (error) => finish(new PortraitGrpcError(`Lỗi native gRPC: ${error.message}`)));
    request.on("end", () => {
      const statusError = grpcError(
        responseTrailers["grpc-status"] ?? responseHeaders["grpc-status"],
        responseTrailers["grpc-message"] ?? responseHeaders["grpc-message"],
      );
      if (statusError) { finish(statusError); return; }
      const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      try { finish(undefined, readNativeMessage(body)); }
      catch (error) { finish(error); }
    });
    request.end(frameMessage(encodeChangeBackground(input)));
  });
}
