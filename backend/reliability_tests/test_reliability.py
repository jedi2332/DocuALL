"""DocuALL regression tests. Run: cd backend && python -m unittest discover -s reliability_tests -v"""
import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

import server
import storage


DEVICE_ID = "a5f3f3d1-2b3c-4d5e-8f91-9a9a9a9a9a9a"


class StorageSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        patcher = patch.multiple(
            storage,
            DATA_DIR=self.data,
            FILES_DIR=self.data / "files",
            DB_PATH=self.data / "db.json",
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_regular_file_round_trip(self):
        rel = storage.save_file(DEVICE_ID, "scan.jpg", b"the-document")
        self.assertEqual(storage.read_file(rel), b"the-document")
        storage.delete_file(rel)
        with self.assertRaises(FileNotFoundError):
            storage.read_file(rel)

    def test_rejects_device_id_traversal(self):
        for bad_id in ("../outside", "../../..", "a/b", "", ".", "a\\b"):
            with self.subTest(bad_id=bad_id), self.assertRaises(ValueError):
                storage.save_file(bad_id, "x.pdf", b"data")

    def test_rejects_filename_traversal(self):
        for bad_name in ("../x.pdf", "/tmp/x.pdf", "..", "a/b.pdf"):
            with self.subTest(bad_name=bad_name), self.assertRaises(ValueError):
                storage.save_file(DEVICE_ID, bad_name, b"data")

    def test_refuses_read_and_delete_outside_files_directory(self):
        outsider = self.data / "outside.txt"
        outsider.write_text("keep me", encoding="utf-8")
        with self.assertRaises(ValueError):
            storage.read_file("../outside.txt")
        with self.assertRaises(ValueError):
            storage.delete_file("../outside.txt")
        self.assertEqual(outsider.read_text(encoding="utf-8"), "keep me")

    def test_corrupt_database_is_never_silently_reset(self):
        storage.DB_PATH.write_text("{broken", encoding="utf-8")
        with self.assertRaises(RuntimeError):
            storage.create_document({"owner_id": DEVICE_ID, "title": "test"})
        self.assertEqual(storage.DB_PATH.read_text(encoding="utf-8"), "{broken")

    def test_document_is_scoped_to_device_id(self):
        item = storage.create_document({"owner_id": DEVICE_ID, "title": "Private"})
        self.assertIsNotNone(storage.get_document(item["id"], DEVICE_ID))
        self.assertIsNone(storage.get_document(item["id"], "other-device"))


class ApiInputTests(unittest.TestCase):
    def test_bad_image_encoding_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            server._decode_b64("not-base64!?")
        self.assertEqual(caught.exception.status_code, 400)

    def test_oversized_scan_is_rejected(self):
        huge_encoded = "A" * (((server.MAX_SCAN_IMAGE_BYTES + 2) // 3) * 4 + 12)
        with self.assertRaises(HTTPException) as caught:
            server._decode_b64(huge_encoded)
        self.assertEqual(caught.exception.status_code, 413)

    def test_pdf_header_and_size_are_checked_before_disk_write(self):
        async def bad_pdf():
            upload = UploadFile(filename="fake.pdf", file=io.BytesIO(b"not a pdf"))
            return await server.import_pdf(file=upload, title=None, x_device_id=DEVICE_ID)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(bad_pdf())
        self.assertEqual(caught.exception.status_code, 400)

    def test_signing_coordinates_and_field_types_rejected(self):
        bad_fields = [
            {"type": "text", "x": -0.1, "y": 0.5, "w": 0.1},
            {"type": "text", "x": 0.5, "y": 2, "w": 0.1},
            {"type": "html", "x": 0.5, "y": 0.5, "w": 0.1},
            {"type": "signature", "x": 0.5, "y": 0.5, "w": 0},
        ]
        for payload in bad_fields:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                server.FieldPlacement(**payload)

    def test_expiry_range_is_bounded(self):
        with self.assertRaises(ValidationError):
            server.SigningRequestCreate(
                signer_name="Someone", fields=[{"type": "text", "x": 0.1, "y": 0.1, "w": 0.02}],
                expiry_days=1000,
            )

    def test_empty_signer_field_list_rejected(self):
        with self.assertRaises(ValidationError):
            server.CompleteSigningRequest(fields=[])


if __name__ == "__main__":
    unittest.main()
