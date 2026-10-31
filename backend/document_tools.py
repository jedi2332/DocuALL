"""Non-destructive PDF assembly. Source files are never written."""
import io
from pypdf import PdfReader, PdfWriter

MAX_SOURCE_BYTES = 50 * 1024 * 1024
MAX_PAGES = 100


def validate_import(raw):
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted:
            raise ValueError('Unlock password-protected PDFs before importing them.')
        count = len(reader.pages)
        if not 1 <= count <= MAX_PAGES:
            raise ValueError('Import a PDF with 1–100 pages.')
        return count
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('This file could not be read as a PDF.') from exc


def assemble(sources, selections):
    if sum(len(raw) for raw in sources.values()) > MAX_SOURCE_BYTES:
        raise ValueError('Selected documents exceed the 50 MB limit.')
    readers = {}
    for doc_id, raw in sources.items():
        try:
            reader = PdfReader(io.BytesIO(raw))
            if reader.is_encrypted:
                raise ValueError('Unlock password-protected PDFs before organizing them.')
            if not 1 <= len(reader.pages) <= MAX_PAGES:
                raise ValueError('Each source must contain 1–100 pages.')
            if reader.get_fields():
                raise ValueError('Interactive PDF forms are not supported by page tools yet. Export a filled copy first.')
            readers[doc_id] = reader
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError('A selected PDF could not be read. Import a valid PDF and try again.') from exc
    writer = PdfWriter()
    seen = set()
    for selection in selections:
        key = (selection['document_id'], selection['page_index'])
        if key in seen:
            raise ValueError('Each source page can appear only once.')
        seen.add(key)
        reader = readers[key[0]]
        if key[1] >= len(reader.pages):
            raise ValueError('A selected page no longer exists. Reload your documents.')
        # Exclude article chains which can pull unrelated pages into an extract.
        page = writer.add_page(reader.pages[key[1]], excluded_keys=['/B'])
        if selection['rotation']:
            page.rotate(selection['rotation'])
        # Normalize orientation so later signing overlays and previews share
        # the same page coordinates, including PDFs already rotated on import.
        if page.rotation:
            page.transfer_rotation_to_content()
    out = io.BytesIO()
    writer.write(out)
    if out.tell() > MAX_SOURCE_BYTES:
        raise ValueError('The resulting PDF exceeds the 50 MB limit.')
    return out.getvalue()
