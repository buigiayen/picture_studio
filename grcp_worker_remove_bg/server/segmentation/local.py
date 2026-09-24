from server.segmentation.base import BaseSegmenter, SegmenterUnavailable


class LocalSegmenter(BaseSegmenter):
    name = "local:rembg"

    def __init__(self, model_name="isnet-general-use"):
        self.model_name = model_name
        self._session = None

    def _load_session(self):
        if self._session is None:
            try:
                from rembg import new_session
            except ImportError as exc:
                raise SegmenterUnavailable("rembg is not installed") from exc
            try:
                self._session = new_session(self.model_name)
            except Exception as exc:
                raise SegmenterUnavailable("unable to load local model %s" % self.model_name) from exc
        return self._session

    def remove_background(self, image_bytes):
        session = self._load_session()
        from rembg import remove

        data = remove(image_bytes, session=session)
        return self.validate_png_bytes(data)