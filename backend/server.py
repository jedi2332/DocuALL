"""
DocuALL backend.

Runs entirely on local disk - no MongoDB, no third-party proxy required.
Optional AI field extraction is off by default. It runs only when
OPENAI_API_KEY is set and DOCUALL_ENABLE_AI_EXTRACTION=true.

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""
import base64
import logging
import os
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional
import re

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import pdf_utils
import storage
import billing

ROOT_DIR = Path(__file__).parent
STATIC_DIR = ROOT_DIR / "static"
load_dotenv(ROOT_DIR / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
AI_EXTRACTION_ENABLED = os.environ.get("DOCUALL_ENABLE_AI_EXTRACTION", "false").strip().lower() in {"1", "true", "yes", "on"}
MAX_PDF_BYTES = 25 * 1024 * 1024
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
APP_NAME = "docuall"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("docuall")

app = FastAPI(title="DocuALL API")
api_router = APIRouter(prefix="/api")


def validated_device_id(x_device_id: str = Header(..., alias="X-Device-Id")) -> str:
    """Reject path-like owner IDs before they reach the storage layer."""
    if not DEVICE_ID_RE.fullmatch(x_device_id):
        raise HTTPException(status_code=400, detail="Invalid device ID")
    return x_device_id


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class PageInput(BaseModel):
    base64: str = Field(min_length=1, max_length=16_000_000)
    enhance: bool = True
    grayscale: bool = False


class DocumentCreate(BaseModel):
    pages: List[PageInput] = Field(min_length=1, max_length=20)
    title: Optional[str] = Field(default=None, max_length=160)


class DocumentUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class SignatureCreate(BaseModel):
    kind: str = "draw"  # draw | type
    strokes: Optional[List[List[dict]]] = None
    aspect: float = 2.5
    stroke_width: int = 6
    text: Optional[str] = None


class SignPlacement(BaseModel):
    signature_id: str
    page_index: int = 0
    x: float  # fraction of page width, top-left anchored
    y: float  # fraction of page height, top-left anchored
    w: float  # fraction of page width the signature should be drawn at


class FieldPlacement(BaseModel):
    type: str  # signature | initials | date | text
    page_index: int = 0
    x: float  # fraction of page width, top-left anchored
    y: float  # fraction of page height, top-left anchored
    w: float  # image fields: fraction of page width. text/date fields: fraction of page height (font size)
    signature_id: Optional[str] = None  # required for signature / initials
    text: Optional[str] = None  # required for date / text


class ApplyFields(BaseModel):
    fields: List[FieldPlacement]


class PendingFieldIn(BaseModel):
    type: str  # signature | initials | date | text
    page_index: int = 0
    x: float
    y: float
    w: float
    label: Optional[str] = None


class SigningRequestCreate(BaseModel):
    signer_name: str
    fields: List[PendingFieldIn]
    expiry_days: Optional[int] = 30


class SigningRequestOut(BaseModel):
    id: str
    doc_id: str
    signer_name: str
    status: str
    created_at: str
    completed_at: Optional[str] = None
    expires_at: Optional[str] = None
    url: str


class FilledFieldIn(BaseModel):
    id: str  # matches the pending field's id assigned when the request was created
    kind: str  # draw | type | text
    strokes: Optional[List[List[dict]]] = None
    aspect: Optional[float] = None
    stroke_width: Optional[int] = None
    text: Optional[str] = None


class CompleteSigningRequest(BaseModel):
    fields: List[FilledFieldIn]


class ProfileUpdate(BaseModel):
    full_name: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    zip_code: str = ""
    employer: str = ""


class DocumentOut(BaseModel):
    id: str
    title: str
    kind: str = "scanned"  # scanned | imported
    vendor: Optional[str] = None
    doc_date: Optional[str] = None
    amount: Optional[str] = None
    category: Optional[str] = None
    page_count: int = 0
    pdf_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    created_at: str
    updated_at: str
    ocr_text: Optional[str] = None


class SignatureOut(BaseModel):
    id: str
    kind: str
    image_path: str
    created_at: str


def _doc_out(doc: dict) -> DocumentOut:
    return DocumentOut(**{k: doc.get(k) for k in DocumentOut.model_fields if k in doc})


def _sig_out(sig: dict) -> SignatureOut:
    return SignatureOut(id=sig["id"], kind=sig["kind"], image_path=sig["image_path"], created_at=sig["created_at"])


def _require_doc(doc_id: str, device_id: str) -> dict:
    doc = storage.get_document(doc_id, device_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _decode_b64(b64: str) -> bytes:
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


# ---------------------------------------------------------------------------
# Optional AI field extraction (title / vendor / date / amount guess)
# ---------------------------------------------------------------------------
async def extract_fields(page_b64: str) -> dict:
    default = {"title": "", "vendor": "", "doc_date": "", "amount": "", "category": "Other"}
    if not OPENAI_API_KEY or not AI_EXTRACTION_ENABLED:
        return default
    try:
        import json as _json

        import requests

        raw_b64 = page_b64.split(",", 1)[1] if page_b64.strip().startswith("data:") else page_b64
        resp = await run_in_threadpool(
            requests.post,
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "Look at this scanned document and return ONLY minified JSON with keys "
                                    "title, vendor, doc_date (yyyy-mm-dd or ''), amount (with currency symbol "
                                    "or ''), category (one of Receipt, Invoice, Contract, ID, Letter, Form, "
                                    "Note, Other). No markdown fences."
                                ),
                            },
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{raw_b64}"}},
                        ],
                    }
                ],
                "max_tokens": 300,
            },
            timeout=30,
        )
        resp.raise_for_status()
        text = resp.json()["choices"][0]["message"]["content"].strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            data = _json.loads(text[start : end + 1])
            return {**default, **{k: str(data.get(k) or "") for k in default}}
    except Exception as e:  # noqa
        logger.warning("AI extraction skipped: %s", e)
    return default


# ---------------------------------------------------------------------------
# Routes: documents
# ---------------------------------------------------------------------------
@api_router.get("/billing/status")
async def billing_status(x_device_id: str = Depends(validated_device_id)):
    return await run_in_threadpool(billing.get_status, x_device_id)


@api_router.get("/")
async def root():
    return {"message": "DocuALL backend", "ok": True, "ai_extraction": bool(OPENAI_API_KEY and AI_EXTRACTION_ENABLED)}


@api_router.post("/documents", response_model=DocumentOut)
async def create_document(payload: DocumentCreate, x_device_id: str = Depends(validated_device_id)):
    """Creates a document from freshly scanned/imported photo pages."""
    if not payload.pages:
        raise HTTPException(status_code=400, detail="No pages provided")

    page_bytes_list = [
        pdf_utils.decode_and_process_page(_decode_b64(p.base64), p.enhance, p.grayscale) for p in payload.pages
    ]
    fields = await extract_fields(payload.pages[0].base64)

    ts = storage.new_id()
    page_paths = []
    for i, pb in enumerate(page_bytes_list):
        page_paths.append(await run_in_threadpool(storage.save_file, x_device_id, f"{ts}_p{i}.jpg", pb))

    thumb_bytes = pdf_utils.make_thumbnail(page_bytes_list[0])
    thumb_path = await run_in_threadpool(storage.save_file, x_device_id, f"{ts}_thumb.jpg", thumb_bytes)

    pdf_bytes = pdf_utils.build_pdf_from_images(page_bytes_list)
    pdf_path = await run_in_threadpool(storage.save_file, x_device_id, f"{ts}.pdf", pdf_bytes)

    title = (payload.title or fields.get("title") or "").strip()
    if not title:
        title = f"Scan {datetime.now(timezone.utc).strftime('%b %d, %Y %H:%M')}"

    doc = storage.create_document(
        {
            "owner_id": x_device_id,
            "title": title,
            "kind": "scanned",
            "vendor": fields.get("vendor") or "",
            "doc_date": fields.get("doc_date") or "",
            "amount": fields.get("amount") or "",
            "category": fields.get("category") or "Other",
            "page_paths": page_paths,
            "pdf_path": pdf_path,
            "thumbnail_path": thumb_path,
            "page_count": len(page_paths),
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "deleted_at": None,
        }
    )
    return _doc_out(doc)


@api_router.post("/documents/import-pdf", response_model=DocumentOut)
async def import_pdf(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    x_device_id: str = Depends(validated_device_id),
):
    """Imports an existing PDF file as-is (used for the "Import PDF" action)."""
    raw = await file.read(MAX_PDF_BYTES + 1)
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF is too large. The upload limit is 25 MB.")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    ts = storage.new_id()
    pdf_path = await run_in_threadpool(storage.save_file, x_device_id, f"{ts}.pdf", raw)

    page_count = pdf_utils.pdf_page_count(raw)
    rendered = pdf_utils.render_page_as_image(raw, 0)
    thumb_bytes = pdf_utils.make_thumbnail(rendered) if rendered else pdf_utils.generic_pdf_thumbnail()
    thumb_path = await run_in_threadpool(storage.save_file, x_device_id, f"{ts}_thumb.jpg", thumb_bytes)

    doc_title = (title or file.filename or "Imported PDF").rsplit(".", 1)[0].strip() or "Imported PDF"

    doc = storage.create_document(
        {
            "owner_id": x_device_id,
            "title": doc_title,
            "kind": "imported",
            "vendor": "",
            "doc_date": "",
            "amount": "",
            "category": "Other",
            "page_paths": [],
            "pdf_path": pdf_path,
            "thumbnail_path": thumb_path,
            "page_count": page_count,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "deleted_at": None,
        }
    )
    return _doc_out(doc)


@api_router.get("/documents", response_model=List[DocumentOut])
async def list_documents(x_device_id: str = Depends(validated_device_id)):
    return [_doc_out(d) for d in storage.list_documents(x_device_id)]


@api_router.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_document(doc_id: str, x_device_id: str = Depends(validated_device_id)):
    return _doc_out(_require_doc(doc_id, x_device_id))


@api_router.patch("/documents/{doc_id}", response_model=DocumentOut)
async def rename_document(doc_id: str, payload: DocumentUpdate, x_device_id: str = Depends(validated_device_id)):
    _require_doc(doc_id, x_device_id)
    doc = storage.update_document(doc_id, {"title": payload.title.strip(), "updated_at": now_iso()})
    return _doc_out(doc)


@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, x_device_id: str = Depends(validated_device_id)):
    if not storage.hard_delete_document(doc_id, x_device_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


@api_router.post("/documents/{doc_id}/sign", response_model=DocumentOut)
async def sign_document(doc_id: str, placement: SignPlacement, x_device_id: str = Depends(validated_device_id)):
    """Kept for backwards compatibility - places a single signature. Prefer
    /apply-fields, which supports mixing in initials/date/text fields and
    applies everything in one pass."""
    return await apply_fields(
        doc_id,
        ApplyFields(
            fields=[
                FieldPlacement(
                    type="signature",
                    page_index=placement.page_index,
                    x=placement.x,
                    y=placement.y,
                    w=placement.w,
                    signature_id=placement.signature_id,
                )
            ]
        ),
        x_device_id,
    )


async def _apply_resolved_fields(doc: dict, resolved: List[dict], device_id: str) -> dict:
    """Shared by /apply-fields (the owner signing their own doc) and the
    public signing-request completion route (an external recipient signing
    via the browser link) - stamps a batch of resolved fields (each with
    "image" bytes or "text") onto the document in one pass."""
    ts = storage.new_id()
    page_count = doc.get("page_count", 1)
    for item in resolved:
        if item["page_index"] < 0 or item["page_index"] >= page_count:
            raise HTTPException(status_code=400, detail="Invalid page index")

    if doc.get("kind") == "imported":
        pdf_bytes = await run_in_threadpool(storage.read_file, doc["pdf_path"])
        new_pdf = await run_in_threadpool(pdf_utils.composite_fields_on_pdf, pdf_bytes, resolved)
        pdf_path = await run_in_threadpool(storage.save_file, device_id, f"{ts}_signed.pdf", new_pdf)
        return storage.update_document(doc["id"], {"pdf_path": pdf_path, "updated_at": now_iso()})

    # scanned document: composite each affected page's fields in one pass, then rebuild the pdf
    page_paths = list(doc.get("page_paths", []))
    by_page: dict = {}
    for item in resolved:
        by_page.setdefault(item["page_index"], []).append(item)

    new_first_page_bytes = None
    for page_index, fields in by_page.items():
        page_bytes = await run_in_threadpool(storage.read_file, page_paths[page_index])
        new_page = await run_in_threadpool(pdf_utils.composite_fields_on_image, page_bytes, fields)
        new_page_path = await run_in_threadpool(storage.save_file, device_id, f"{ts}_p{page_index}.jpg", new_page)
        page_paths[page_index] = new_page_path
        if page_index == 0:
            new_first_page_bytes = new_page

    all_pages = [await run_in_threadpool(storage.read_file, p) for p in page_paths]
    pdf_bytes = pdf_utils.build_pdf_from_images(all_pages)
    pdf_path = await run_in_threadpool(storage.save_file, device_id, f"{ts}.pdf", pdf_bytes)

    patch = {"page_paths": page_paths, "pdf_path": pdf_path, "updated_at": now_iso()}
    if new_first_page_bytes is not None:
        thumb = pdf_utils.make_thumbnail(new_first_page_bytes)
        patch["thumbnail_path"] = await run_in_threadpool(storage.save_file, device_id, f"{ts}_thumb.jpg", thumb)

    return storage.update_document(doc["id"], patch)


@api_router.post("/documents/{doc_id}/apply-fields", response_model=DocumentOut)
async def apply_fields(doc_id: str, payload: ApplyFields, x_device_id: str = Depends(validated_device_id)):
    """Stamps one or more fields (signature, initials, date, text) onto a
    document in a single pass - this is what powers the "prepare & sign"
    screen, which can drop down any number/mix of fields across pages
    before applying them all at once."""
    doc = _require_doc(doc_id, x_device_id)
    if not payload.fields:
        raise HTTPException(status_code=400, detail="No fields provided")

    resolved: List[dict] = []
    for f in payload.fields:
        item = {"type": f.type, "page_index": f.page_index, "x": f.x, "y": f.y, "w": f.w}
        if f.type in ("signature", "initials"):
            if not f.signature_id:
                raise HTTPException(status_code=400, detail=f"{f.type} field needs a signature_id")
            sig = storage.get_signature(f.signature_id, x_device_id)
            if not sig:
                raise HTTPException(status_code=404, detail="Signature not found")
            item["image"] = await run_in_threadpool(storage.read_file, sig["image_path"])
        else:
            item["text"] = f.text or ""
        resolved.append(item)

    doc = await _apply_resolved_fields(doc, resolved, x_device_id)
    return _doc_out(doc)


# ---------------------------------------------------------------------------
# Routes: saved profile and OCR
# ---------------------------------------------------------------------------
@api_router.get("/profile")
async def get_profile(x_device_id: str = Depends(validated_device_id)):
    return storage.get_profile(x_device_id)


@api_router.patch("/profile")
async def patch_profile(payload: ProfileUpdate, x_device_id: str = Depends(validated_device_id)):
    return storage.update_profile(x_device_id, payload.model_dump())


@api_router.post("/documents/{doc_id}/ocr")
async def run_ocr(doc_id: str, x_device_id: str = Depends(validated_device_id)):
    await run_in_threadpool(billing.require_pro, x_device_id)
    doc = _require_doc(doc_id, x_device_id)
    text = ""
    if doc.get("pdf_path"):
        try:
            from pypdf import PdfReader
            raw = await run_in_threadpool(storage.read_file, doc["pdf_path"])
            reader = PdfReader(__import__("io").BytesIO(raw))
            text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        except Exception as exc:
            logger.warning("PDF text extraction failed: %s", exc)
    if not text and doc.get("page_paths"):
        try:
            import pytesseract
            from PIL import Image
            import io
            chunks = []
            for path in doc.get("page_paths", []):
                image = Image.open(io.BytesIO(await run_in_threadpool(storage.read_file, path)))
                chunks.append(await run_in_threadpool(pytesseract.image_to_string, image))
            text = "\n".join(chunks).strip()
        except ImportError:
            raise HTTPException(status_code=501, detail="OCR is not installed on this server. Install pytesseract and tesseract-ocr, then restart DocuALL.")
        except Exception as exc:
            logger.warning("OCR failed: %s", exc)
    if not text:
        raise HTTPException(status_code=422, detail="No readable text was found in this document")
    updated = storage.update_document(doc_id, {"ocr_text": text, "updated_at": now_iso()})
    return {"text": text, "document": _doc_out(updated)}


@api_router.post("/documents/{doc_id}/auto-fill-profile")
async def auto_fill_profile(doc_id: str, payload: ApplyFields, x_device_id: str = Depends(validated_device_id)):
    doc = _require_doc(doc_id, x_device_id)
    profile = storage.get_profile(x_device_id)
    values = {
        "name": profile.get("full_name", ""), "full name": profile.get("full_name", ""),
        "email": profile.get("email", ""), "phone": profile.get("phone", ""),
        "address": profile.get("address", ""), "city": profile.get("city", ""),
        "state": profile.get("state", ""), "zip": profile.get("zip_code", ""),
        "zip code": profile.get("zip_code", ""), "employer": profile.get("employer", ""),
    }
    resolved = []
    for f in payload.fields:
        label = (f.text or "").strip().lower()
        value = next((v for key, v in values.items() if key in label and v), "")
        if not value:
            continue
        resolved.append({"type": "text", "page_index": f.page_index, "x": f.x, "y": f.y, "w": f.w, "text": value})
    if not resolved:
        raise HTTPException(status_code=422, detail="No profile fields matched. Add field labels such as name, email, phone, or address.")
    return _doc_out(await _apply_resolved_fields(doc, resolved, x_device_id))


# ---------------------------------------------------------------------------
# Routes: signing requests ("send for signature" - a link an external
# recipient without the app can open in a browser to fill in placeholder
# fields; there's no email sending here, the owner shares the link
# themselves via the native share sheet, same as sharing a PDF).
# ---------------------------------------------------------------------------
def _signing_request_out(req: dict, base_url: str) -> SigningRequestOut:
    return SigningRequestOut(
        id=req["id"],
        doc_id=req["doc_id"],
        signer_name=req["signer_name"],
        status=req["status"],
        created_at=req["created_at"],
        completed_at=req.get("completed_at"),
        expires_at=req.get("expires_at"),
        url=f"{base_url.rstrip('/')}/sign/{req['token']}",
    )


@api_router.post("/documents/{doc_id}/signing-requests", response_model=SigningRequestOut)
async def create_signing_request(doc_id: str, payload: SigningRequestCreate, request: Request, x_device_id: str = Depends(validated_device_id)):
    await run_in_threadpool(billing.require_pro, x_device_id)
    _require_doc(doc_id, x_device_id)
    if not payload.fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    if not payload.signer_name.strip():
        raise HTTPException(status_code=400, detail="Signer name is required")

    fields = [{**f.model_dump(), "id": storage.new_id()} for f in payload.fields]
    req = storage.create_signing_request(
        {
            "owner_id": x_device_id,
            "doc_id": doc_id,
            "signer_name": payload.signer_name.strip(),
            "token": secrets.token_urlsafe(16),
            "status": "pending",
            "fields": fields,
            "created_at": now_iso(),
            "completed_at": None,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=max(1, min(payload.expiry_days or 30, 365)))).isoformat() if payload.expiry_days != 0 else None,
        }
    )
    return _signing_request_out(req, str(request.base_url))


@api_router.get("/documents/{doc_id}/signing-requests", response_model=List[SigningRequestOut])
async def list_signing_requests(doc_id: str, request: Request, x_device_id: str = Depends(validated_device_id)):
    _require_doc(doc_id, x_device_id)
    reqs = storage.list_signing_requests(doc_id, x_device_id)
    return [_signing_request_out(r, str(request.base_url)) for r in reqs]


@api_router.delete("/signing-requests/{req_id}")
async def cancel_signing_request(req_id: str, x_device_id: str = Depends(validated_device_id)):
    req = storage.get_signing_request(req_id, x_device_id)
    if not req:
        raise HTTPException(status_code=404, detail="Not found")
    if req.get("status") == "completed":
        raise HTTPException(status_code=409, detail="Completed requests cannot be cancelled")
    storage.update_signing_request(req_id, {"status": "cancelled"})
    return {"ok": True}


def _require_active_signing_request(token: str) -> dict:
    req = storage.get_signing_request_by_token(token)
    if not req:
        raise HTTPException(status_code=404, detail="Signing link not found")
    if req.get("expires_at") and datetime.fromisoformat(req["expires_at"]) <= datetime.now(timezone.utc):
        if req.get("status") == "pending":
            storage.update_signing_request(req["id"], {"status": "expired"})
        raise HTTPException(status_code=410, detail="This signing link has expired")
    if req.get("status") != "pending":
        raise HTTPException(status_code=410, detail="This signing link is no longer active")
    return req


@api_router.get("/public/signing-requests/{token}")
async def get_public_signing_request(token: str):
    """No device auth - the token itself is the credential, same as any
    emailed signing link (DocuSign etc. work the same way)."""
    req = _require_active_signing_request(token)
    doc = storage.get_document(req["doc_id"], req["owner_id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "signer_name": req["signer_name"],
        "status": req["status"],
        "doc": {"id": doc["id"], "title": doc["title"], "page_count": doc["page_count"], "kind": doc["kind"]},
        "fields": [] if req["status"] != "pending" else req["fields"],
    }


@api_router.get("/public/signing-requests/{token}/page/{page_index}")
async def get_public_signing_request_page(token: str, page_index: int):
    req = _require_active_signing_request(token)
    doc = storage.get_document(req["doc_id"], req["owner_id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.get("kind") == "imported":
        pdf_bytes = await run_in_threadpool(storage.read_file, doc["pdf_path"])
        rendered = await run_in_threadpool(pdf_utils.render_page_as_image, pdf_bytes, page_index)
        if rendered is None:
            rendered = pdf_utils.generic_pdf_thumbnail()
        return Response(content=rendered, media_type="image/jpeg")

    page_paths = doc.get("page_paths", [])
    if page_index < 0 or page_index >= len(page_paths):
        raise HTTPException(status_code=404, detail="Page not found")
    content = await run_in_threadpool(storage.read_file, page_paths[page_index])
    return Response(content=content, media_type="image/jpeg")


@api_router.post("/public/signing-requests/{token}/complete")
async def complete_signing_request(token: str, payload: CompleteSigningRequest):
    req = _require_active_signing_request(token)

    doc = storage.get_document(req["doc_id"], req["owner_id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    filled_by_id = {f.id: f for f in payload.fields}
    missing = [f["id"] for f in req["fields"] if f["id"] not in filled_by_id]
    if missing:
        raise HTTPException(status_code=400, detail="Every field must be filled in before completing")

    resolved: List[dict] = []
    for pending in req["fields"]:
        filled = filled_by_id[pending["id"]]
        item = {"type": pending["type"], "page_index": pending["page_index"], "x": pending["x"], "y": pending["y"], "w": pending["w"]}
        if pending["type"] in ("signature", "initials"):
            if filled.kind == "draw":
                if not filled.strokes:
                    raise HTTPException(status_code=400, detail=f"Missing drawn {pending['type']}")
                item["image"] = pdf_utils.render_drawn_signature(filled.strokes, filled.aspect or 2.5, filled.stroke_width or 6)
            else:
                item["image"] = pdf_utils.render_typed_signature(filled.text or req["signer_name"])
        else:
            item["text"] = filled.text or ""
        resolved.append(item)

    await _apply_resolved_fields(doc, resolved, req["owner_id"])
    storage.update_signing_request(req["id"], {"status": "completed", "completed_at": now_iso()})
    return {"ok": True}


@app.get("/sign/{token}")
async def signer_page(token: str):
    return FileResponse(STATIC_DIR / "sign.html")


@api_router.get("/documents/{doc_id}/page/{page_index}")
async def get_document_page_image(doc_id: str, page_index: int, x_device_id: str = Depends(validated_device_id)):
    """Returns a JPEG for one page, used by the sign-placement screen."""
    doc = _require_doc(doc_id, x_device_id)
    if doc.get("kind") == "imported":
        pdf_bytes = await run_in_threadpool(storage.read_file, doc["pdf_path"])
        rendered = await run_in_threadpool(pdf_utils.render_page_as_image, pdf_bytes, page_index)
        if rendered is None:
            rendered = pdf_utils.generic_pdf_thumbnail()
        return Response(content=rendered, media_type="image/jpeg")

    page_paths = doc.get("page_paths", [])
    if page_index < 0 or page_index >= len(page_paths):
        raise HTTPException(status_code=404, detail="Page not found")
    content = await run_in_threadpool(storage.read_file, page_paths[page_index])
    return Response(content=content, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Routes: signatures
# ---------------------------------------------------------------------------
@api_router.post("/signatures", response_model=SignatureOut)
async def create_signature(payload: SignatureCreate, x_device_id: str = Depends(validated_device_id)):
    if payload.kind == "draw":
        if not payload.strokes:
            raise HTTPException(status_code=400, detail="No strokes")
        png = pdf_utils.render_drawn_signature(payload.strokes, payload.aspect, payload.stroke_width)
    else:
        png = pdf_utils.render_typed_signature(payload.text or "")

    path = await run_in_threadpool(storage.save_file, x_device_id, f"sig_{storage.new_id()}.png", png)
    sig = storage.create_signature(
        {"owner_id": x_device_id, "kind": payload.kind, "image_path": path, "created_at": now_iso(), "deleted_at": None}
    )
    return _sig_out(sig)


@api_router.get("/signatures", response_model=List[SignatureOut])
async def list_signatures(x_device_id: str = Depends(validated_device_id)):
    return [_sig_out(s) for s in storage.list_signatures(x_device_id)]


@api_router.delete("/signatures/{sig_id}")
async def delete_signature(sig_id: str, x_device_id: str = Depends(validated_device_id)):
    if not storage.soft_delete_signature(sig_id, x_device_id, now_iso()):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# File serving (thumbnails, per-page images, final PDFs for download/share)
# ---------------------------------------------------------------------------
@api_router.get("/files/{file_path:path}")
async def serve_file(file_path: str, device: str = Query(...)):
    parts = Path(file_path).parts
    if not DEVICE_ID_RE.fullmatch(device) or len(parts) != 2 or parts[0] != device or any(part in {".", ".."} for part in parts):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not storage.is_active_file(file_path, device):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        content = await run_in_threadpool(storage.read_file, file_path)
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=404, detail="File not found")
    ctype = "application/pdf" if file_path.endswith(".pdf") else "image/jpeg" if file_path.endswith(".jpg") else "image/png"
    return Response(content=content, media_type=ctype)


@app.middleware("http")
async def private_response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

