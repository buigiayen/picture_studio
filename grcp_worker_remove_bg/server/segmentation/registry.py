from server.segmentation.base import SegmenterError
from server.segmentation.local import LocalSegmenter
from server.segmentation.providers.clipdrop import ClipDropSegmenter
from server.segmentation.providers.removebg import RemoveBgSegmenter


class SegmenterRegistry:
    def __init__(self, providers):
        self.providers = providers

    @property
    def names(self):
        return [p.name for p in self.providers]

    def segment(self, image_bytes):
        if not self.providers:
            raise SegmenterError("no segmentation provider is available")
        failures = []
        for provider in self.providers:
            try:
                output = provider.remove_background(image_bytes)
                return output, provider.name
            except SegmenterError as exc:
                failures.append(exc)
        raise failures[-1]

    @classmethod
    def from_config(cls, cfg):
        env = cfg.env
        providers = []

        if cfg.local_enabled:
            providers.append(LocalSegmenter(cfg.local_model))

        for name in cfg.ai_order:
            key = name.lower()
            if key == "remove.bg":
                providers.append(RemoveBgSegmenter(env.get("AI_REMOVEBG_API_KEY", ""), cfg.ai_timeout))
            elif key == "clipdrop":
                providers.append(ClipDropSegmenter(env.get("AI_CLIPDROP_API_KEY", ""), cfg.ai_timeout))

        return cls(providers)