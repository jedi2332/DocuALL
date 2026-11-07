"""Behavioral tests for DocuALL's strictly read-only local asset auditor."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asset_guardian import audit_assets


class AssetGuardianAuditTests(unittest.TestCase):
    def test_capcut_reference_and_duplicate_are_never_deleted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            project_dir = root / "CapCut"
            media_dir = root / "assets"
            project_dir.mkdir()
            media_dir.mkdir()
            original = media_dir / "original.mp4"
            duplicate = root / "copy.mp4"
            original.write_bytes(b"video-source-unchanged")
            duplicate.write_bytes(b"video-source-unchanged")
            project = project_dir / "draft_content.json"
            project.write_text(
                json.dumps({"materials": [{"path": "../assets/original.mp4"}]}),
                encoding="utf-8",
            )

            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            report = audit_assets(root)
            after = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}

            self.assertEqual(before, after)
            self.assertEqual(report["mode"], "read_only")
            self.assertTrue(report["scan_complete"])
            self.assertEqual(report["files_deleted"], 0)
            self.assertEqual(report["files_modified"], 0)
            self.assertEqual(report["referenced_media_count"], 1)
            self.assertEqual(report["project_manifests"], ["CapCut/draft_content.json"])
            self.assertEqual(len(report["duplicate_groups"]), 1)
            group = report["duplicate_groups"][0]
            self.assertEqual(group["action"], "review_only")
            self.assertEqual({f["path"] for f in group["files"]}, {"assets/original.mp4", "copy.mp4"})
            self.assertTrue(all(f["protected"] for f in group["files"]))
            original_entry = next(f for f in group["files"] if f["path"] == "assets/original.mp4")
            self.assertIn("referenced by project", original_entry["protection_reasons"])

    def test_missing_project_media_is_reported_without_changing_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            project = root / "draft_content.json"
            content = '{"materials":[{"path":"missing.mov"}]}'
            project.write_text(content, encoding="utf-8")
            report = audit_assets(root)
            self.assertEqual(report["referenced_media_count"], 0)
            self.assertEqual(len(report["unresolved_project_dependencies"]), 1)
            self.assertEqual(project.read_text(encoding="utf-8"), content)

    def test_avoids_following_symlinks_outside_root(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as external:
            root = Path(folder)
            outside = Path(external) / "private.mov"
            outside.write_bytes(b"do-not-inspect")
            try:
                (root / "link.mov").symlink_to(outside)
            except (OSError, NotImplementedError):
                self.skipTest("Symlinks unavailable on this platform")
            report = audit_assets(root)
            self.assertEqual(report["scanned_files"], 0)
            self.assertEqual(report["skipped_symlinks"], 1)
            self.assertEqual(report["duplicate_groups"], [])

    def test_file_limit_marks_report_incomplete(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "one.txt").write_text("one")
            (root / "two.txt").write_text("two")
            report = audit_assets(root, max_files=1)
            self.assertFalse(report["scan_complete"])
            self.assertTrue(report["max_file_limit_reached"])
            self.assertEqual(report["scanned_files"], 1)

    def test_invalid_manifest_is_nonfatal_and_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "draft_content.json").write_text("{not-json", encoding="utf-8")
            report = audit_assets(root)
            self.assertEqual(report["files_deleted"], 0)
            self.assertFalse(report["scan_complete"])
            self.assertTrue(report["errors"])


if __name__ == "__main__":
    unittest.main()
