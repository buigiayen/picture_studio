import io

from PIL import Image, ImageChops, ImageEnhance, ImageFilter


class CompositeError(Exception):
    pass


class Compositor:
    def __init__(self, alpha_feather=2, jpeg_quality=90):
        self.alpha_feather = alpha_feather
        self.jpeg_quality = jpeg_quality

    def composite_color(
        self,
        subject_rgba,
        color,
        max_dimension=None,
        output_format="png",
        sharpness=0,
        beauty_strength=0,
    ):
        if max_dimension is not None and max_dimension < 8:
            raise CompositeError("max_dimension must be >= 8")
        if not 0 <= beauty_strength <= 100:
            raise CompositeError("beauty_strength must be in range 0..100")

        img = Image.open(io.BytesIO(subject_rgba)).convert("RGBA")

        if max_dimension is not None:
            width, height = img.size
            longest = max(width, height)
            if longest > max_dimension:
                scale = max_dimension / float(longest)
                new_size = (max(int(width * scale), 1), max(int(height * scale), 1))
                img = img.resize(new_size, Image.LANCZOS)

        if beauty_strength:
            img = self._beautify_skin(img, beauty_strength)

        alpha = img.getchannel("A")
        if self.alpha_feather and self.alpha_feather > 0:
            alpha = alpha.filter(ImageFilter.GaussianBlur(self.alpha_feather))

        r, g, b, a = color
        background = Image.new("RGBA", img.size, (r, g, b, a))
        result = Image.alpha_composite(background, img)

        if sharpness:
            result = self._sharpen(result, sharpness)

        if output_format == "jpeg":
            rgb = Image.new("RGB", result.size, (255, 255, 255))
            rgb.paste(result, mask=result.getchannel("A"))
            return self._encode(rgb, "JPEG", self.jpeg_quality)

        return self._encode(result, "PNG")

    @staticmethod
    def _beautify_skin(image, amount):
        """Brighten and soften likely skin pixels while preserving everything else."""
        alpha = image.getchannel("A")
        rgb = image.convert("RGB")
        y, cb, cr = rgb.convert("YCbCr").split()

        # Broad YCbCr skin range works across light and dark complexions. The
        # luminance limit prevents near-black hair and white clothing entering
        # the mask; alpha keeps the removed background out of the operation.
        cb_mask = cb.point([255 if 75 <= value <= 135 else 0 for value in range(256)])
        cr_mask = cr.point([255 if 128 <= value <= 180 else 0 for value in range(256)])
        y_mask = y.point([255 if 25 <= value <= 245 else 0 for value in range(256)])
        skin_mask = ImageChops.multiply(ImageChops.multiply(cb_mask, cr_mask), y_mask)
        skin_mask = ImageChops.multiply(skin_mask, alpha)

        strength = amount / 100.0
        radius = max(0.8, min(image.size) / 900.0) * (0.8 + strength)
        softened = rgb.filter(ImageFilter.GaussianBlur(radius=radius))
        retouched = Image.blend(rgb, softened, min(0.75, strength * 0.8))
        retouched = ImageEnhance.Brightness(retouched).enhance(1.0 + strength * 0.18)

        # A small feather avoids visible transitions at the edge of skin areas.
        skin_mask = skin_mask.filter(ImageFilter.GaussianBlur(radius=max(1.0, radius * 0.65)))
        result = Image.composite(retouched, rgb, skin_mask).convert("RGBA")
        result.putalpha(alpha)
        return result

    @staticmethod
    def _sharpen(image, amount):
        if amount <= 0:
            return image
        alpha = image.getchannel("A")
        rgb = image.convert("RGB")
        enhanced = ImageEnhance.Sharpness(rgb).enhance(1.0 + amount / 100.0)
        enhanced.putalpha(alpha)
        return enhanced

    @staticmethod
    def _encode(image, fmt, quality=None):
        buffer = io.BytesIO()
        if fmt == "JPEG":
            image.save(buffer, fmt, quality=quality)
        else:
            image.save(buffer, fmt)
        return buffer.getvalue()
