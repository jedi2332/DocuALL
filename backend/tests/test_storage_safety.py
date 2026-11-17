"""DocuALL storage safety and ownership regression tests."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage


class StorageSafetyTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original = (storage.DATA_DIR, storage.FILES_DIR, storage.DB_PATH)
        storage.DATA_DIR = Path(self.folder.name)
        storage.FILES_DIR = storage.DATA_DIR / "files"
        storage.DB_PATH = storage.DATA_DIR / "db.json"

    def tearDown(self):
        storage.DATA_DIR, storage.FILES_DIR, storage.DB_PATH = self.original
        self.folder.cleanup()

    def test_reject_traversal_and_invalid_device_ids(self):
        for device in ("../other", "..", "/tmp", "user/sub", "user\\sub", ""):
            with self.subTest(device=device):
                with self.assertRaises(ValueError):
                    storage.save_file(device, "test.pdf", b"secret")
        with self.assertRaises(ValueError):
            storage.save_file("valid-user", "../outside.pdf", b"secret")
        with self.assertRaises(ValueError):
            storage.save_file("valid-user", "..", b"secret")

    def test_round_trip_and_reject_delete_outside_root(self):
        rel = storage.save_file("valid-user", "safe.pdf", b"%PDF-1.4")
        self.assertEqual(storage.read_file(rel), b"%PDF-1.4")
        with self.assertRaises(ValueError):
            storage.delete_file("../../elsewhere")
        self.assertTrue((storage.FILES_DIR / rel).exists())

    def test_soft_delete_prevents_cross_device_mutation(self):
        doc = storage.create_document({"owner_id": "alice", "title": "Receipt", "deleted_at": None})
        self.assertFalse(storage.soft_delete_document(doc["id"], "bob", "2026-11-17"))
        self.assertIsNotNone(storage.get_document(doc["id"], "alice"))
        self.assertTrue(storage.soft_delete_document(doc["id"], "alice", "2026-11-17"))
        self.assertFalse(storage.soft_delete_document(doc["id"], "alice", "2026-11-18"))
        self.assertIsNone(storage.get_document(doc["id"], "alice"))

    def test_atomic_owned_updates_reject_other_owner_and_deleted_documents(self):
        doc = storage.create_document({"owner_id": "alice", "title": "Original", "deleted_at": None})
        self.assertIsNone(storage.update_document(doc["id"], {"title": "Stolen"}, owner_id="bob"))
        self.assertEqual(storage.get_document(doc["id"], "alice")["title"], "Original")
        self.assertEqual(storage.update_document(doc["id"], {"title": "Mine"}, owner_id="alice")["title"], "Mine")
        for field, value in (("owner_id", "bob"), ("deleted_at", None), ("id", "fake")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                storage.update_document(doc["id"], {field: value}, owner_id="alice")
        self.assertTrue(storage.soft_delete_document(doc["id"], "alice", "2026-11-17"))
        self.assertIsNone(storage.update_document(doc["id"], {"title": "Resurrected"}, owner_id="alice"))

    def test_deleted_signature_cannot_be_deleted_again(self):
        sig = storage.create_signature({"owner_id": "alice", "deleted_at": None})
        self.assertFalse(storage.soft_delete_signature(sig["id"], "bob", "2026-11-17"))
        self.assertTrue(storage.soft_delete_signature(sig["id"], "alice", "2026-11-17"))
        self.assertFalse(storage.soft_delete_signature(sig["id"], "alice", "2026-11-18"))


if __name__ == "__main__":
    unittest.main()
