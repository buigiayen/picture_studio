import requests

from server.segmentation.base import BaseSegmenter, SegmenterFailed, SegmenterUnavailable


class RemoveBgSegmenter(BaseSegmenter):
    name = "ai:remove.bg"
    endpoint = "https://api.remove.bg/v1.0/removebg"

    def __init__(self, api_key, timeout=60.0):
        self.api_key = api_key
        self.timeout = timeout

    def remove_background(self, image_bytes):
        if not self.api_key:
            raise SegmenterUnavailable("remove.bg API key is not configured")
        try:
            resp = requests.post(
                self.endpoint,
                files={"image_file": image_bytes},
                data={"format": "png", "size": "auto"},
                headers={"X-Api-Key": self.api_key},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise SegmenterFailed(self.name, str(exc)) from exc
        if resp.status_code != 200:
            raise SegmenterFailed(
                self.name,
                resp.text[:500] or "http %d" % resp.status_code,
                status_code=resp.status_code,
            )
        return self.validate_png_bytes(resp.content)