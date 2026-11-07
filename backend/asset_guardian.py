"""Read-only asset audit for DocuALL Smart Clean & Organize.

Never deletes, renames, moves, uploads, or rewrites files. In particular,
CapCut projects, original media, and referenced assets are review-only.
Run locally: python backend/asset_guardian.py /path/to/assets
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

MEDIA_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mp3", ".wav",
    ".aac", ".m4a", ".flac", ".aiff", ".jpg", ".jpeg", ".png",
    ".heic", ".webp", ".gif", ".tif", ".tiff", ".bmp",
}
PROJECT_EXTENSIONS = {".ccproj", ".prproj", ".drp", ".veg", ".kdenlive", ".aup3"}
CAPCUT_MANIFESTS = {"draft_content.json", "draft_meta_info.json"}


def _is_capcut(path: Path) -> bool:
    return any("capcut" in part.casefold() for part in path.parts)


def _is_manifest(path: Path) -> bool:
    return path.name.casefold() in CAPCUT_MANIFESTS or (
        path.name.casefold() == "project.json" and _is_capcut(path)
    )


def _walk_strings(value: Any, depth: int = 0):
    if depth > 32:
        return
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item, depth + 1)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _walk_strings(item, depth + 1)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def audit_assets(folder: str | Path, max_files: int = 100_000) -> dict[str, Any]:
    """Inventory without mutating the supplied folder. Results are local-only."""
    root = Path(folder).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Asset root must be a directory")
    if max_files < 1:
        raise ValueError("max_files must be positive")

    paths: list[Path] = []
    errors: list[str] = []
    skipped_symlinks = 0
    cap_hit = False

    def walk_error(error: OSError):
        errors.append(f"Cannot inspect directory: {error}")

    for current, dirs, files in os.walk(root, topdown=True, followlinks=False, onerror=walk_error):
        base = Path(current)
        for name in list(dirs):
            if (base / name).is_symlink():
                dirs.remove(name)
                skipped_symlinks += 1
        for name in files:
            path = base / name
            if path.is_symlink():
                skipped_symlinks += 1
                continue
            if len(paths) >= max_files:
                cap_hit = True
                break
            if path.is_file():
                paths.append(path)
        if cap_hit:
            break

    present = set(paths)
    referenced: set[Path] = set()
    manifests = [path for path in paths if _is_manifest(path)]
    missing_dependencies: set[str] = set()

    for manifest in manifests:
        try:
            if manifest.stat().st_size > 8 * 1024 * 1024:
                errors.append(f"Manifest too large for dependency scan: {manifest.relative_to(root)}")
                continue
            data = json.loads(manifest.read_text(encoding="utf-8"))
            for value in _walk_strings(data):
                if Path(value.replace("\\", "/")).suffix.casefold() not in MEDIA_EXTENSIONS:
                    continue
                location = Path(value.replace("\\", "/"))
                candidates = [location] if location.is_absolute() else [
                    manifest.parent / location, root / location
                ]
                matched = False
                for candidate in candidates:
                    try:
                        full = candidate.resolve()
                        full.relative_to(root)
                    except (ValueError, OSError, RuntimeError):
                        continue
                    if full in present:
                        referenced.add(full)
                        matched = True
                        break
                if not matched:
                    missing_dependencies.add(f"{manifest.relative_to(root)}: {value}")
        except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
            errors.append(f"Cannot parse {manifest.relative_to(root)}: {type(exc).__name__}")

    reasons: dict[Path, list[str]] = {}
    sizes: dict[int, list[Path]] = defaultdict(list)
    for path in paths:
        flags = []
        if _is_capcut(path.relative_to(root)):
            flags.append("CapCut project tree")
        if _is_manifest(path) or path.suffix.casefold() in PROJECT_EXTENSIONS:
            flags.append("project or timeline file")
        if path.suffix.casefold() in MEDIA_EXTENSIONS:
            flags.append("possible original media")
        if path in referenced:
            flags.append("referenced by project")
        reasons[path] = flags
        try:
            sizes[path.stat().st_size].append(path)
        except OSError as exc:
            errors.append(f"Cannot stat {path.relative_to(root)}: {type(exc).__name__}")

    groups: list[dict[str, Any]] = []
    for size, candidates in sizes.items():
        if len(candidates) < 2:
            continue
        by_hash: dict[str, list[Path]] = defaultdict(list)
        for path in candidates:
            try:
                by_hash[_sha256(path)].append(path)
            except OSError as exc:
                errors.append(f"Cannot hash {path.relative_to(root)}: {type(exc).__name__}")
        for digest, identical in by_hash.items():
            if len(identical) < 2:
                continue
            groups.append({
                "sha256": digest,
                "bytes_each": size,
                "files": [{
                    "path": str(path.relative_to(root)),
                    "protected": bool(reasons[path]),
                    "protection_reasons": reasons[path],
                } for path in sorted(identical)],
                "action": "review_only",
            })

    groups.sort(key=lambda group: (-group["bytes_each"], group["sha256"]))
    return {
        "mode": "read_only",
        "root": str(root),
        "scanned_files": len(paths),
        "scan_complete": not cap_hit and not errors,
        "max_file_limit_reached": cap_hit,
        "skipped_symlinks": skipped_symlinks,
        "project_manifests": [str(p.relative_to(root)) for p in manifests],
        "referenced_media_count": len(referenced),
        "protected_files": sum(bool(v) for v in reasons.values()),
        "duplicate_groups": groups,
        "unresolved_project_dependencies": sorted(missing_dependencies),
        "errors": errors,
        "files_deleted": 0,
        "files_modified": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="DocuALL local read-only asset audit")
    parser.add_argument("folder", help="Root folder to inspect (nothing will be changed)")
    parser.add_argument("--max-files", type=int, default=100_000)
    args = parser.parse_args()
    report = audit_assets(args.folder, max_files=args.max_files)
    print(json.dumps(report, indent=2))
    return 0 if report["scan_complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
