"""Run with: python -m unittest discover -s tests -v"""
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
import server
import storage

OWNER = 'owner-device-123'
OTHER = 'other-device-456'


class PrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [patch.object(storage, 'DATA_DIR', root),
                        patch.object(storage, 'FILES_DIR', root / 'files'),
                        patch.object(storage, 'DB_PATH', root / 'db.json')]
        for item in self.patches:
            item.start()
        self.client = TestClient(server.app)
        self.path = storage.save_file(OWNER, 'page.jpg', b'page-content')
        self.doc = storage.create_document(dict(owner_id=OWNER, title='Private',
            kind='scanned', page_count=1, page_paths=[self.path], pdf_path=None,
            thumbnail_path=self.path, deleted_at=None))
        self.req = storage.create_signing_request(dict(owner_id=OWNER, doc_id=self.doc['id'],
            token='test-token', status='pending', signer_name='Recipient', fields=[]))

    def tearDown(self):
        self.client.close()
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_active_link_and_privacy_headers(self):
        response = self.client.get('/api/public/signing-requests/test-token/page/0')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'page-content')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['referrer-policy'], 'no-referrer')

    def test_inactive_links_cannot_read_or_complete(self):
        for status in ['cancelled', 'completed', 'expired']:
            storage.update_signing_request(self.req['id'], {'status': status})
            with self.subTest(status=status):
                for suffix in ['', '/page/0']:
                    self.assertEqual(self.client.get('/api/public/signing-requests/test-token'+suffix).status_code, 410)
                self.assertEqual(self.client.post('/api/public/signing-requests/test-token/complete', json={'fields': []}).status_code, 410)

    def test_expiry_blocks_access(self):
        storage.update_signing_request(self.req['id'], {'expires_at': (datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()})
        self.assertEqual(self.client.get('/api/public/signing-requests/test-token/page/0').status_code, 410)
        self.assertEqual(storage.get_signing_request(self.req['id'], OWNER)['status'], 'expired')

    def test_revocation_blocks_page(self):
        response = self.client.delete('/api/signing-requests/'+self.req['id'], headers={'X-Device-Id': OWNER})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/public/signing-requests/test-token/page/0').status_code, 410)

    def test_completed_request_cannot_be_cancelled(self):
        storage.update_signing_request(self.req['id'], {'status': 'completed'})
        self.assertEqual(self.client.delete('/api/signing-requests/'+self.req['id'], headers={'X-Device-Id': OWNER}).status_code, 409)

    def test_only_active_owned_files_are_downloadable(self):
        url = '/api/files/'+self.path
        self.assertEqual(self.client.get(url, params={'device': OWNER}).status_code, 200)
        self.assertEqual(self.client.get(url, params={'device': OTHER}).status_code, 403)
        orphan = storage.save_file(OWNER, 'orphan.pdf', b'old-version')
        self.assertEqual(self.client.get('/api/files/'+orphan, params={'device': OWNER}).status_code, 404)
        storage.update_document(self.doc['id'], {'deleted_at': 'deleted'})
        self.assertEqual(self.client.get(url, params={'device': OWNER}).status_code, 404)

    def test_document_deletion_removes_files_and_links(self):
        self.assertFalse(storage.hard_delete_document(self.doc['id'], OTHER))
        self.assertTrue(storage.hard_delete_document(self.doc['id'], OWNER))
        self.assertFalse((storage.FILES_DIR/self.path).exists())
        self.assertIsNone(storage.get_signing_request_by_token('test-token'))
        self.assertEqual(self.client.get('/api/files/'+self.path, params={'device': OWNER}).status_code, 404)

    def test_corrupt_database_is_not_overwritten(self):
        storage.DB_PATH.write_text('{broken')
        with self.assertRaises(RuntimeError):
            storage.create_document({'owner_id': OWNER})
        self.assertEqual(storage.DB_PATH.read_text(), '{broken')


if __name__ == '__main__':
    unittest.main()
