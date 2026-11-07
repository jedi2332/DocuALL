# Asset Guardian: Smart Clean & Organize (read-only foundation)

This is a local, **non-destructive** audit utility. It has no deletion, move, rename, sync, or upload code and does not change the DocuALL app or its live API.

## Try it locally

From the repository root, using Python 3.10+:

    python backend/asset_guardian.py "/path/to/a/folder"

Optional file-scan limit:

    python backend/asset_guardian.py "/path/to/a/folder" --max-files 10000

It emits a JSON report to stdout. The report stays on the local computer unless **you** save or share the output. Paths in that report may contain personal information; review before sharing it.

The report includes:
- Exact byte-for-byte duplicate groups (SHA-256 after file-size grouping), always labeled **review_only**.
- CapCut draft manifest detection and a best-effort count of media paths referenced by projects.
- Possible missing project media, so moving or deleting those files doesn't accidentally break a CapCut draft.
- Protection labels for project files, CapCut trees, potential original media and project references.
- Skipped symbolic links, read/permission errors, and whether file-count limits caused a partial scan.

**Critical limits:** JSON paths in project files vary by app/version, and a file may be depended on even if no reference is found. A duplicate does **not** mean an asset is safe to remove. All findings are informational. This module does not automatically clean anything.

## Test

    python -m unittest discover -s backend/tests -p "test_*.py" -v

## Integration status

This module is staged separately from the existing FastAPI document scanner/signature app. It is not yet wired into the backend endpoints, Expo UI, or the user's laptop service. Deliberately so: first establish zero-loss behavior on representative file fixtures and review the final UI and backup workflow.
