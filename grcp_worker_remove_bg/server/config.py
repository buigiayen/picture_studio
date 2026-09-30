import os

from dotenv import load_dotenv

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 50051


class Config:
    def __init__(self, env=None):
        load_dotenv()
        self.env = env if env is not None else os.environ

        self.host = self.env.get("PORTRAIT_HOST", DEFAULT_HOST)
        self.port = int(self.env.get("PORTRAIT_PORT", DEFAULT_PORT))

        self.local_enabled = self._as_bool(self.env.get("LOCAL_SEGMENTATION_ENABLED", "true"))
        self.local_model = self.env.get("LOCAL_SEGMENTATION_MODEL", "isnet-general-use")
        self.onnx_enabled = self._as_bool(self.env.get("ONNX_SEGMENTATION_ENABLED", "true"))
        self.onnx_model_dtype = self.env.get("ONNX_MODEL_DTYPE", "fp32").strip().lower()
        if self.onnx_model_dtype not in ("fp32", "fp16"):
            raise ValueError("ONNX_MODEL_DTYPE must be fp32 or fp16")
        self.onnx_model_cache_dir = self.env.get(
            "ONNX_MODEL_CACHE_DIR", os.path.expanduser("~/.cache/picture_studio/models")
        )
        self.onnx_execution_providers = [
            item.strip() for item in self.env.get("ONNX_EXECUTION_PROVIDERS", "CPUExecutionProvider").split(",")
            if item.strip()
        ]
        if not self.onnx_execution_providers:
            raise ValueError("ONNX_EXECUTION_PROVIDERS must contain at least one provider")
        self.onnx_model_warmup = self._as_bool(self.env.get("ONNX_MODEL_WARMUP", "true"))

        raw_order = self.env.get("AI_PROVIDERS_ORDER", "")
        self.ai_order = [item.strip() for item in raw_order.split(",") if item.strip()]

        self.ai_timeout = float(self.env.get("AI_TIMEOUT_SECONDS", "60"))

        self.max_dimension_limit = int(self.env.get("MAX_DIMENSION_LIMIT", "4096"))
        self.alpha_feather = int(self.env.get("ALPHA_FEATHER", "0"))
        self.jpeg_quality = int(self.env.get("JPEG_QUALITY", "90"))
        self.beauty_strength = int(self.env.get("BEAUTY_STRENGTH", "35"))
        if not 0 <= self.beauty_strength <= 100:
            raise ValueError("BEAUTY_STRENGTH must be in range 0..100")
        self.max_message_size = int(self.env.get("GRPC_MAX_MESSAGE_SIZE", str(64 * 1024 * 1024)))

    @staticmethod
    def _as_bool(value):
        return str(value).strip().lower() in ("1", "true", "yes", "on")
