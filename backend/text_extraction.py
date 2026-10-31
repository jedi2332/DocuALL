"""Local, page-by-page extraction with bounded raster work and explicit gaps."""
import io
import time
from PIL import Image
from pypdf import PdfReader

MAX_CHARS = 200_000
MAX_RASTER_PAGES = 20


def raster_text(raw, index, page_image, timeout):
    import pytesseract
    if page_image is not None:
        image = Image.open(io.BytesIO(page_image))
        image.thumbnail((1600, 1600))
    else:
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(raw, first_page=index+1, last_page=index+1,
                                    dpi=120, size=1600, timeout=timeout, thread_count=1)
        if not images:
            raise ValueError('Page could not be rendered')
        image = images[0]
    try:
        return pytesseract.image_to_string(image, timeout=timeout).strip()
    finally:
        image.close()


def extract(raw, read_page_image=None):
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 100:
        raise ValueError('Use an unlocked PDF with 1–100 pages.')
    chunks, unread = [], []
    used = 0
    raster_count = 0
    deadline = time.monotonic() + 60
    truncated = False
    for index, page in enumerate(reader.pages):
        text = ''
        if time.monotonic() < deadline:
            try:
                text = (page.extract_text() or '').strip()
            except Exception:
                pass
        if not text and raster_count < MAX_RASTER_PAGES and time.monotonic() < deadline:
            raster_count += 1
            try:
                image = read_page_image(index) if read_page_image else None
                text = raster_text(raw, index, image, max(1, min(10, deadline-time.monotonic())))
            except Exception:
                # Missing engines, unreadable scans and timeouts are explicit
                # page gaps, never silently reported as complete extraction.
                pass
        if not text:
            unread.append(index + 1)
            continue
        remaining = MAX_CHARS - used
        if len(text) > remaining:
            text = text[:remaining]
            truncated = True
        chunks.append(f'--- Page {index + 1} ---\n{text}')
        used += len(text)
        if used >= MAX_CHARS:
            truncated = True
            unread.extend(range(index + 2, len(reader.pages) + 1))
            break
    return {'text': '\n\n'.join(chunks), 'unread_pages': unread, 'truncated': truncated}
