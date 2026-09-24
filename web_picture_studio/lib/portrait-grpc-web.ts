type PortraitColor = { red: number; green: number; blue: number; alpha: number };

export type ChangeBackgroundInput = {
  image: Uint8Array;
  backgroundColor: PortraitColor;
  imageName: string;
  outputFormat: string;
  maxDimension: number;
  sharpness: number;
  beautyStrength?: number;
};

export type ChangeBackgroundOutput = {
  image: Uint8Array;
  imageName: string;
  outputFormat: string;
  providerUsed: string;
  latencyMs: number;
  width: number;
  height: number;
};

export class PortraitGrpcError extends Error {
  readonly grpcStatus?: number;

  constructor(message: string, grpcStatus?: number) {
    super(message);
    this.name = "PortraitGrpcError";
    this.grpcStatus = grpcStatus;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function encodeVarint(value: number) {
  const bytes: number[] = [];
  let remaining = Math.max(0, Math.trunc(value));
  while (remaining > 127) {
    bytes.push((remaining % 128) | 128);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Uint8Array.from(bytes);
}

function fieldVarint(field: number, value: number) {
  return concat([encodeVarint(field << 3), encodeVarint(value)]);
}

function fieldBytes(field: number, value: Uint8Array) {
  return concat([encodeVarint((field << 3) | 2), encodeVarint(value.length), value]);
}

function fieldString(field: number, value: string) {
  return fieldBytes(field, encoder.encode(value));
}

function encodeColor(color: PortraitColor) {
  return concat([
    fieldVarint(1, color.red),
    fieldVarint(2, color.green),
    fieldVarint(3, color.blue),
    fieldVarint(4, color.alpha),
  ]);
}

export function encodeChangeBackground(input: ChangeBackgroundInput) {
  const fields = [
    fieldBytes(1, input.image),
    fieldBytes(2, encodeColor(input.backgroundColor)),
    fieldString(3, input.imageName),
    fieldString(4, input.outputFormat),
    fieldVarint(5, input.maxDimension),
    fieldVarint(6, input.sharpness),
  ];
  if (input.beautyStrength !== undefined) fields.push(fieldVarint(7, input.beautyStrength));
  return concat(fields);
}

export function frameMessage(message: Uint8Array) {
  const frame = new Uint8Array(message.length + 5);
  const view = new DataView(frame.buffer);
  frame[0] = 0;
  view.setUint32(1, message.length, false);
  frame.set(message, 5);
  return frame;
}

function readVarint(bytes: Uint8Array, start: number) {
  let value = 0;
  let multiplier = 1;
  let position = start;
  while (position < bytes.length) {
    const byte = bytes[position++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, position };
    multiplier *= 128;
    if (multiplier > Number.MAX_SAFE_INTEGER) break;
  }
  throw new PortraitGrpcError("Phản hồi protobuf không hợp lệ.");
}

function skipField(bytes: Uint8Array, position: number, wireType: number) {
  if (wireType === 0) return readVarint(bytes, position).position;
  if (wireType === 1) return position + 8;
  if (wireType === 2) {
    const length = readVarint(bytes, position);
    return length.position + length.value;
  }
  if (wireType === 5) return position + 4;
  throw new PortraitGrpcError(`Wire type protobuf không được hỗ trợ: ${wireType}.`);
}

export function decodeChangeBackground(bytes: Uint8Array): ChangeBackgroundOutput {
  const result: ChangeBackgroundOutput = {
    image: new Uint8Array(), imageName: "", outputFormat: "png", providerUsed: "",
    latencyMs: 0, width: 0, height: 0,
  };
  let position = 0;
  while (position < bytes.length) {
    const tag = readVarint(bytes, position);
    position = tag.position;
    const field = tag.value >> 3;
    const wireType = tag.value & 7;
    if (wireType === 2 && field >= 1 && field <= 4) {
      const length = readVarint(bytes, position);
      const end = length.position + length.value;
      if (end > bytes.length) throw new PortraitGrpcError("Trường protobuf vượt quá kích thước phản hồi.");
      const value = bytes.slice(length.position, end);
      if (field === 1) result.image = value;
      if (field === 2) result.imageName = decoder.decode(value);
      if (field === 3) result.outputFormat = decoder.decode(value);
      if (field === 4) result.providerUsed = decoder.decode(value);
      position = end;
      continue;
    }
    if (wireType === 1 && field === 5) {
      if (position + 8 > bytes.length) throw new PortraitGrpcError("Trường latency protobuf không hợp lệ.");
      result.latencyMs = new DataView(bytes.buffer, bytes.byteOffset + position, 8).getFloat64(0, true);
      position += 8;
      continue;
    }
    if (wireType === 0 && (field === 6 || field === 7)) {
      const value = readVarint(bytes, position);
      if (field === 6) result.width = value.value;
      if (field === 7) result.height = value.value;
      position = value.position;
      continue;
    }
    position = skipField(bytes, position, wireType);
    if (position > bytes.length) throw new PortraitGrpcError("Phản hồi protobuf bị cắt ngắn.");
  }
  if (!result.image.length) throw new PortraitGrpcError("Dịch vụ gRPC không trả về dữ liệu ảnh.");
  return result;
}

function parseTrailers(payload: Uint8Array) {
  const trailers = new Map<string, string>();
  for (const line of decoder.decode(payload).split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) trailers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return trailers;
}

function decodeGrpcWeb(body: Uint8Array, headerStatus: string | null, headerMessage: string | null) {
  let position = 0;
  let message: Uint8Array | null = null;
  let grpcStatus = headerStatus;
  let grpcMessage = headerMessage;
  while (position < body.length) {
    if (position + 5 > body.length) throw new PortraitGrpcError("Frame gRPC-Web bị cắt ngắn.");
    const flag = body[position];
    const length = new DataView(body.buffer, body.byteOffset + position + 1, 4).getUint32(0, false);
    position += 5;
    const end = position + length;
    if (end > body.length) throw new PortraitGrpcError("Kích thước frame gRPC-Web không hợp lệ.");
    const payload = body.slice(position, end);
    position = end;
    if ((flag & 0x80) !== 0) {
      const trailers = parseTrailers(payload);
      grpcStatus = trailers.get("grpc-status") ?? grpcStatus;
      grpcMessage = trailers.get("grpc-message") ?? grpcMessage;
    } else {
      if ((flag & 0x01) !== 0) throw new PortraitGrpcError("Phản hồi gRPC nén chưa được hỗ trợ.");
      message = payload;
    }
  }
  const status = Number(grpcStatus ?? 0);
  if (!Number.isFinite(status) || status !== 0) {
    let detail = grpcMessage || `gRPC status ${grpcStatus ?? "không xác định"}`;
    try { detail = decodeURIComponent(detail); } catch { /* Keep the original server message. */ }
    throw new PortraitGrpcError(detail, Number.isFinite(status) ? status : undefined);
  }
  if (!message) throw new PortraitGrpcError("Dịch vụ gRPC không trả về message.");
  return decodeChangeBackground(message);
}

function changeBackgroundUrl(base: string) {
  const url = new URL(base);
  if (!/^https?:$/.test(url.protocol)) throw new PortraitGrpcError("PORTRAIT_GRPC_URL phải dùng HTTP hoặc HTTPS.");
  const methodPath = "/portrait.PortraitService/ChangeBackground";
  if (!url.pathname.endsWith(methodPath)) url.pathname = `${url.pathname.replace(/\/$/, "")}${methodPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function callChangeBackground(
  endpoint: string,
  input: ChangeBackgroundInput,
  options: { token?: string; timeoutMs?: number } = {},
) {
  const message = encodeChangeBackground(input);
  const timeoutMs = Math.min(120_000, Math.max(1_000, options.timeoutMs ?? 60_000));
  const headers = new Headers({
    "Content-Type": "application/grpc-web+proto",
    Accept: "application/grpc-web+proto",
    "X-Grpc-Web": "1",
    "X-User-Agent": "studio-anh/1.0",
    "Grpc-Timeout": `${timeoutMs}m`,
  });
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  const response = await fetch(changeBackgroundUrl(endpoint), {
    method: "POST",
    headers,
    body: frameMessage(message),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new PortraitGrpcError(`Dịch vụ gRPC trả về HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("grpc-web-text")) throw new PortraitGrpcError("Endpoint phải bật gRPC-Web binary, không phải grpc-web-text.");
  const body = new Uint8Array(await response.arrayBuffer());
  return decodeGrpcWeb(body, response.headers.get("grpc-status"), response.headers.get("grpc-message"));
}
