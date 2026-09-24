declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PORTRAIT_GRPC_URL?: string;
    PORTRAIT_GRPC_TRANSPORT?: string;
    PORTRAIT_GRPC_TOKEN?: string;
    PORTRAIT_GRPC_TIMEOUT_MS?: string;
  }
}
