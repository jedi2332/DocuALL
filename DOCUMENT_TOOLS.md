# PDF tools

Open **PDF tools** from the document home screen.

1. Add an existing scanned or imported document.
2. Add another document to combine PDFs, or keep one to organize it.
3. Use Up/Down to reorder, Rotate for quarter-turns, and Remove to exclude a page.
   Undo restores the last arrangement (up to 20 steps).
4. Name the result and tap **Save new PDF**.

To extract pages, remove everything you do not want in the new copy.
The originals remain available. The new PDF opens in the normal document
screen for viewing, signing and sharing.

Limits: 10 source documents, 100 output pages, 50 MB total source/output size.
Password-protected PDFs must be unlocked before import. Interactive forms
are not supported by these page tools; export a filled, non-interactive copy
first. Digital signature certification is not preserved in a new PDF.
This does not sanitize metadata or redact hidden content.

Implementation: POST /api/documents/assemble receives a title and ordered
pages with document_id, zero-based page_index and rotation (0/90/180/270).
Every source is authorized before bytes are read. The operation writes new
assets only and rolls them back if metadata creation fails. New output has
the same owner-only access rules as other documents. PDFs are composed
without rasterizing their text; orientations are normalized for later signing.
