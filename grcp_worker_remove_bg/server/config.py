import os

from dotenv import load_dotenv

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 50051


class Config:
    def __init__(self, env=None):
        load_dotenv()
        self.env = env or os.environ

        self.host = self.env.get("PORTRAIT_HOST", DEFAULT_HOST)
        self.port = int(self.env.get("PORTRAIT_PORT", DEFAULT_PORT))

        self.local_enabled = self._as_bool(self.env.get("LOCAL_SEGMENTATION_ENABLED", "true"))
        self.local_model = self.env.get("LOCAL_SEGMENTATION_MODEL", "isnet-general-use")

        raw_order = self.env.get("AI_PROVIDERS_ORDER", "remove.bg,clipdrop")
        self.ai_order = [item.strip() for item in raw_order.split(",") if item.strip()]

        self.ai_timeout = float(self.env.get("AI_TIMEOUT_SECONDS", "60"))

        self.max_dimension_limit = int(self.env.get("MAX_DIMENSION_LIMIT", "4096"))
        self.alpha_feather = int(self.env.get("ALPHA_FEATHER", "2"))
        self.jpeg_quality = int(self.env.get("JPEG_QUALITY", "90"))
        self.beauty_strength = int(self.env.get("BEAUTY_STRENGTH", "35"))
        if not 0 <= self.beauty_strength <= 100:
            raise ValueError("BEAUTY_STRENGTH must be in range 0..100")
        self.max_message_size = int(self.env.get("GRPC_MAX_MESSAGE_SIZE", str(64 * 1024 * 1024)))

    @staticmethod
    def _as_bool(value):
        return str(value).strip().lower() in ("1", "true", "yes", "on")
