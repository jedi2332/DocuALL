"""
Local storage layer for DocuALL.

Replaces the original Mongo + Emergent-proxy object storage with plain
files on disk, so the whole backend can run with `pip install -r
requirements.txt` and nothing else (no database server, no third-party
API key required).

Layout on disk (under DATA_DIR, default ./data):
    data/
      db.json                 <- documents + signatures metadata
      files/<device_id>/...   <- images, pdfs, signature pngs
"""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
FILES_DIR = DATA_DIR / "files"
DB_PATH = DATA_DIR / "db.json"

_lock = threading.Lock()


def _empty_db() -> Dict[str, Any]:
    return {"documents": {}, "signatures": {}, "signing_requests": {}, "profiles": {}}


def _load() -> Dict[str, Any]:
    if not DB_PATH.exists():
        return _empty_db()
    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("documents", {})
        data.setdefault("signatures", {})
        data.setdefault("signing_requests", {})
        data.setdefault("profiles", {})
        return data
    except (json.JSONDecodeError, OSError):
        return _empty_db()


def _save(data: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DB_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(DB_PATH)


def new_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# File (blob) storage
# ---------------------------------------------------------------------------
def save_file(device_id: str, filename: str, data: bytes) -> str:
    """Writes bytes inside one owner's directory and returns its relative path."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", device_id):
        raise ValueError("Invalid device ID")
    if not filename or Path(filename).name != filename or filename in {".", ".."}:
        raise ValueError("Invalid filename")

    root = FILES_DIR.resolve()
    target = (FILES_DIR / device_id / filename).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("Invalid storage path") from exc

    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as f:
        f.write(data)
    return f"{device_id}/{filename}"


def read_file(rel_path: str) -> bytes:
    full = (FILES_DIR / rel_path).resolve()
    if FILES_DIR.resolve() not in full.parents and full != FILES_DIR.resolve():
        raise FileNotFoundError(rel_path)
    with open(full, "rb") as f:
        return f.read()


def delete_file(rel_path: str) -> None:
    full = FILES_DIR / rel_path
    try:
        full.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
def create_document(doc: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        data = _load()
        doc_id = new_id()
        doc = {**doc, "id": doc_id}
        data["documents"][doc_id] = doc
        _save(data)
        return doc


def update_document(doc_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with _lock:
        data = _load()
        doc = data["documents"].get(doc_id)
        if not doc:
            return None
        doc.update(patch)
        data["documents"][doc_id] = doc
        _save(data)
        return doc


def get_document(doc_id: str, owner_id: str) -> Optional[Dict[str, Any]]:
    data = _load()
    doc = data["documents"].get(doc_id)
    if not doc or doc.get("owner_id") != owner_id or doc.get("deleted_at"):
        return None
    return doc


def list_documents(owner_id: str) -> List[Dict[str, Any]]:
    data = _load()
    docs = [
        d
        for d in data["documents"].values()
        if d.get("owner_id") == owner_id and not d.get("deleted_at")
    ]
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return docs


def soft_delete_document(doc_id: str, owner_id: str, deleted_at: str) -> bool:
    doc = get_document(doc_id, owner_id)
    if not doc:
        return False
    update_document(doc_id, {"deleted_at": deleted_at})
    return True


# ---------------------------------------------------------------------------
# Signatures
# ---------------------------------------------------------------------------
def create_signature(sig: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        data = _load()
        sig_id = new_id()
        sig = {**sig, "id": sig_id}
        data["signatures"][sig_id] = sig
        _save(data)
        return sig


def get_signature(sig_id: str, owner_id: str) -> Optional[Dict[str, Any]]:
    data = _load()
    sig = data["signatures"].get(sig_id)
    if not sig or sig.get("owner_id") != owner_id or sig.get("deleted_at"):
        return None
    return sig


def list_signatures(owner_id: str) -> List[Dict[str, Any]]:
    data = _load()
    sigs = [
        s
        for s in data["signatures"].values()
        if s.get("owner_id") == owner_id and not s.get("deleted_at")
    ]
    sigs.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return sigs


def soft_delete_signature(sig_id: str, owner_id: str, deleted_at: str) -> bool:
    data = _load()
    sig = data["signatures"].get(sig_id)
    if not sig or sig.get("owner_id") != owner_id:
        return False
    with _lock:
        data = _load()
        data["signatures"][sig_id]["deleted_at"] = deleted_at
        _save(data)
    return True


# ---------------------------------------------------------------------------
# Signing requests ("send for signature" - a shareable link a recipient who
# doesn't have the app can open in a browser to fill in placeholder fields)
# ---------------------------------------------------------------------------
def create_signing_request(req: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        data = _load()
        req_id = new_id()
        req = {**req, "id": req_id}
        data["signing_requests"][req_id] = req
        _save(data)
        return req


def get_signing_request(req_id: str, owner_id: str) -> Optional[Dict[str, Any]]:
    data = _load()
    req = data["signing_requests"].get(req_id)
    if not req or req.get("owner_id") != owner_id:
        return None
    return req


def get_signing_request_by_token(token: str) -> Optional[Dict[str, Any]]:
    data = _load()
    for req in data["signing_requests"].values():
        if req.get("token") == token:
            return req
    return None


def list_signing_requests(doc_id: str, owner_id: str) -> List[Dict[str, Any]]:
    data = _load()
    reqs = [
        r
        for r in data["signing_requests"].values()
        if r.get("doc_id") == doc_id and r.get("owner_id") == owner_id
    ]
    reqs.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return reqs


def update_signing_request(req_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with _lock:
        data = _load()
        req = data["signing_requests"].get(req_id)
        if not req:
            return None
        req.update(patch)
        data["signing_requests"][req_id] = req
        _save(data)
        return req


# ---------------------------------------------------------------------------
# Saved profile
# ---------------------------------------------------------------------------
def get_profile(owner_id: str) -> dict:
    data = _load()
    return data.get("profiles", {}).get(owner_id, {"owner_id": owner_id})

def update_profile(owner_id: str, patch: dict) -> dict:
    allowed = {"full_name", "email", "phone", "address", "city", "state", "zip_code", "employer"}
    with _lock:
        data = _load()
        data.setdefault("profiles", {})
        current = data["profiles"].get(owner_id, {"owner_id": owner_id})
        current.update({k: str(v or "").strip() for k, v in patch.items() if k in allowed})
        current["owner_id"] = owner_id
        data["profiles"][owner_id] = current
        _save(data)
        return current
