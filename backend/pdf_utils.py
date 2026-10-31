"""
Image + PDF helpers for DocuALL.

Two kinds of documents flow through here:
  * "scanned" documents: a list of camera/gallery photos we control end to
    end, so we render them as JPEGs and build the PDF ourselves.
  * "imported" documents: a real PDF the user already had, which we keep
    intact and only touch (via an overlay) when a signature is placed.
"""
from __future__ import annotations

import io
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:  # pragma: no cover - surfaced clearly at startup instead
    PdfReader = PdfWriter = None  # type: ignore

try:
    from reportlab.pdfgen import canvas as _rl_canvas
except ImportError:  # pragma: no cover
    _rl_canvas = None  # type: ignore


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------
def decode_and_process_page(raw: bytes, enhance: bool, grayscale: bool) -> bytes:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    max_dim = 2200
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim))
    if grayscale:
        img = ImageOps.grayscale(img).convert("RGB")
    if enhance:
        img = ImageOps.autocontrast(img, cutoff=1)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=87)
    return out.getvalue()


def make_thumbnail(image_bytes: bytes, size: Tuple[int, int] = (420, 420)) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img.thumbnail(size)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=82)
    return out.getvalue()


def generic_pdf_thumbnail(label: str = "PDF") -> bytes:
    """A simple placeholder thumbnail for imported PDFs we can't rasterize
    (no poppler/pdftoppm available). Good enough for a document-list icon."""
    img = Image.new("RGB", (420, 420), (241, 238, 232))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([60, 40, 360, 380], radius=18, outline=(120, 110, 95), width=4)
    d.rectangle([60, 40, 360, 110], fill=(120, 110, 95))
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((420 - tw) / 2, 200 - th / 2), label, fill=(120, 110, 95), font=font)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


def build_pdf_from_images(pages: List[bytes]) -> bytes:
    imgs = [Image.open(io.BytesIO(p)).convert("RGB") for p in pages]
    out = io.BytesIO()
    imgs[0].save(out, format="PDF", save_all=True, append_images=imgs[1:], resolution=150.0)
    return out.getvalue()


def render_page_as_image(pdf_bytes: bytes, page_index: int) -> Optional[bytes]:
    """Best-effort rasterization of one PDF page to a JPEG, used so the
    signature-placement screen has something to show for imported PDFs.
    Requires pdf2image + poppler; returns None if unavailable so callers can
    fall back to a generic placeholder instead of failing the request."""
    try:
        from pdf2image import convert_from_bytes

        images = convert_from_bytes(pdf_bytes, first_page=page_index + 1, last_page=page_index + 1, dpi=150)
        if not images:
            return None
        out = io.BytesIO()
        images[0].convert("RGB").save(out, format="JPEG", quality=85)
        return out.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Signatures
# ---------------------------------------------------------------------------
def render_drawn_signature(strokes: List[List[dict]], aspect: float, stroke_width: int) -> bytes:
    W = 900
    H = int(W / max(aspect, 0.2))
    scaled_width = max(2, int(stroke_width * (W / 300.0)))
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = (28, 28, 26, 255)
    for stroke in strokes or []:
        pts = [(p["x"] * W, p["y"] * H) for p in stroke if "x" in p and "y" in p]
        if len(pts) == 1:
            x, y = pts[0]
            r = scaled_width / 2
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
        elif len(pts) > 1:
            draw.line(pts, fill=color, width=scaled_width, joint="curve")
            r = scaled_width / 2
            for x, y in (pts[0], pts[-1]):
                draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
    return _trim_and_encode_png(img)


def render_typed_signature(text: str, font_path: Optional[str] = None) -> bytes:
    text = (text or "").strip() or "Signature"
    size = 200
    font = None
    if font_path:
        try:
            font = ImageFont.truetype(font_path, size)
        except Exception:
            font = None
    if font is None:
        try:
            font = ImageFont.load_default(size=size)
        except TypeError:
            font = ImageFont.load_default()
    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = 40
    img = Image.new("RGBA", (max(tw + pad * 2, 1), max(th + pad * 2, 1)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((pad - bbox[0], pad - bbox[1]), text, font=font, fill=(28, 28, 26, 255))
    return _trim_and_encode_png(img)


def _trim_and_encode_png(img: Image.Image) -> bytes:
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def composite_signature_on_image(page_bytes: bytes, sig_bytes: bytes, x: float, y: float, w: float) -> bytes:
    """x, y, w are fractions (0-1) of the page's width/height, top-left anchored."""
    return composite_fields_on_image(page_bytes, [{"type": "signature", "x": x, "y": y, "w": w, "image": sig_bytes}])


def composite_fields_on_image(page_bytes: bytes, fields: List[dict]) -> bytes:
    """Stamps any mix of image fields (signature/initials) and text fields
    (date/text) onto one page image in a single pass."""
    page = Image.open(io.BytesIO(page_bytes)).convert("RGBA")
    pw, ph = page.size
    for field in fields:
        if field["type"] in ("signature", "initials"):
            sig = Image.open(io.BytesIO(field["image"])).convert("RGBA")
            target_w = max(1, int(field["w"] * pw))
            scale = target_w / sig.width
            target_h = max(1, int(sig.height * scale))
            sig = sig.resize((target_w, target_h))
            page.alpha_composite(sig, (int(field["x"] * pw), int(field["y"] * ph)))
        else:
            font_size = max(10, int(field["w"] * ph))
            try:
                font = ImageFont.load_default(size=font_size)
            except TypeError:
                font = ImageFont.load_default()
            draw = ImageDraw.Draw(page)
            draw.text((field["x"] * pw, field["y"] * ph), field.get("text") or "", font=font, fill=(28, 28, 26, 255))
    out = io.BytesIO()
    page.convert("RGB").save(out, format="JPEG", quality=90)
    return out.getvalue()


def composite_signature_on_pdf(pdf_bytes: bytes, sig_png: bytes, page_index: int, x: float, y: float, w: float) -> bytes:
    """Stamps a signature PNG directly onto a real PDF page (used for
    imported PDFs, so we never have to rasterize-and-rebuild the whole
    document just to sign one page)."""
    return composite_fields_on_pdf(pdf_bytes, [{"type": "signature", "page_index": page_index, "x": x, "y": y, "w": w, "image": sig_png}])


def _draw_image_field(c, page_w: float, page_h: float, field: dict) -> None:
    from reportlab.lib.utils import ImageReader

    sig_img = Image.open(io.BytesIO(field["image"]))
    sig_ratio = sig_img.height / sig_img.width
    draw_w = field["w"] * page_w
    draw_h = draw_w * sig_ratio
    draw_x = field["x"] * page_w
    draw_y = page_h - (field["y"] * page_h) - draw_h
    c.drawImage(ImageReader(io.BytesIO(field["image"])), draw_x, draw_y, width=draw_w, height=draw_h, mask="auto")


def _draw_text_field(c, page_w: float, page_h: float, field: dict) -> None:
    font_size = max(8, field["w"] * page_h)
    draw_x = field["x"] * page_w
    draw_y = page_h - (field["y"] * page_h) - font_size
    c.setFont("Helvetica", font_size)
    c.setFillColorRGB(0.11, 0.11, 0.1)
    c.drawString(draw_x, draw_y, field.get("text") or "")


def composite_fields_on_pdf(pdf_bytes: bytes, fields: List[dict]) -> bytes:
    """Stamps any mix of image fields (signature/initials, each with an
    "image" PNG) and text fields (date/text, each with "text") onto a real
    PDF, one overlay per affected page so multiple fields on the same page
    only cost one merge."""
    if PdfReader is None or _rl_canvas is None:
        raise RuntimeError("pypdf and reportlab are required to sign imported PDFs")

    reader = PdfReader(io.BytesIO(pdf_bytes))
    by_page: dict = {}
    for f in fields:
        by_page.setdefault(f["page_index"], []).append(f)

    for page_index, page_fields in by_page.items():
        if page_index < 0 or page_index >= len(reader.pages):
            raise IndexError("page_index out of range")
        page = reader.pages[page_index]
        page_w = float(page.mediabox.width)
        page_h = float(page.mediabox.height)

        overlay_buf = io.BytesIO()
        c = _rl_canvas.Canvas(overlay_buf, pagesize=(page_w, page_h))
        for field in page_fields:
            if field["type"] in ("signature", "initials"):
                _draw_image_field(c, page_w, page_h, field)
            else:
                _draw_text_field(c, page_w, page_h, field)
        c.save()
        overlay_buf.seek(0)
        overlay_reader = PdfReader(overlay_buf)
        page.merge_page(overlay_reader.pages[0])

    writer = PdfWriter()
    for p in reader.pages:
        writer.add_page(p)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def pdf_page_count(pdf_bytes: bytes) -> int:
    if PdfReader is None:
        return 1
    return len(PdfReader(io.BytesIO(pdf_bytes)).pages)
